import { useState } from 'react';
import { api, type MyTimeSlips, type TimeSlipBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';

// Time slip (Fauzan, 4 Nov 2026, rule HR-TIME-SLIP): leave the office for a few hours on your own matters, work the
// hours back after 5.30 pm within 30 days, or they are taken from annual leave in half days.

type Row = MyTimeSlips['mine'][number];
type Waiting = MyTimeSlips['toDecide'][number];

const STATUS: Record<Row['slip']['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  refused: { label: 'Refused', tone: 'crit' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Minutes as "2 h 30 min". */
export function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

function todayMyt(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** Where the make-up of one approved slip stands. */
function MakeUp({ r }: { r: Row }) {
  const s = r.slip;
  if (s.status !== 'approved' || !r.makeUp) return null;
  if (s.settlement)
    return (
      <div className="small">
        <Chip tone={s.settlement.shortfallMin ? 'warn' : 'ok'}>{s.settlement.shortfallMin ? 'Closed, leave taken' : 'Worked back'}</Chip>{' '}
        {hm(s.settlement.madeUpMin)} of {hm(s.minutes)} worked back. {s.settlement.note}
      </div>
    );
  const { madeUpMin, leftMin } = r.makeUp;
  return (
    <div className="small">
      {leftMin === 0 ? (
        <Chip tone="ok">Worked back</Chip>
      ) : (
        <Chip tone="info">
          {hm(leftMin)} to work back by {dateLabel(s.makeUpBy!)}
        </Chip>
      )}{' '}
      {hm(madeUpMin)} of {hm(s.minutes)} worked back after office hours.
      {leftMin > 0 && ` If not worked back, ${r.makeUp.leaveDaysIfNotDone} day of annual leave is taken.`}
    </div>
  );
}

function SlipLine({ r, who }: { r: Row; who?: boolean }) {
  const s = r.slip;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <strong>
            {who ? `${s.userName} · ` : ''}
            {dateLabel(s.date)}, {s.from} to {s.to}
          </strong>{' '}
          <span className="muted small">({hm(s.minutes)})</span>
        </div>
        <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Chip>
      </div>
      <div className="small">{s.reason}</div>
      {s.decidedBy && (
        <div className="muted small">
          {s.status === 'approved' ? 'Approved' : 'Refused'} by {s.decidedBy}
          {s.decisionNote ? `: “${s.decisionNote}”` : ''}
        </div>
      )}
      <MakeUp r={r} />
    </div>
  );
}

/** Approve or refuse a slip waiting for this user, always with a comment. */
function DecideLine({ w }: { w: Waiting }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const s = w.slip;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <SlipLine r={w} who />
      {w.openHoursMin > 0 && <div className="small">Still to work back from earlier slips: {hm(w.openHoursMin)}.</div>}
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Comment for ${s.userName}`} placeholder="Comment (needed to approve or refuse)" />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.decideTimeSlip(s.id, true, note), 'Time slip approved. HR is told.')}>
          Approve
        </button>
        <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.decideTimeSlip(s.id, false, note), 'Time slip refused.')}>
          Refuse
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AskForm({ data }: { data: MyTimeSlips }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayMyt());
  const [from, setFrom] = useState('14:00');
  const [to, setTo] = useState('16:00');
  const [reason, setReason] = useState('');
  const act = useAction();
  const r = data.rule.value;
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Ask for a time slip
      </button>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="grid-2">
        <label className="field">
          <span className="label">Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="label">Out at</span>
            <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Out at" />
          </label>
          <label className="field">
            <span className="label">Back at</span>
            <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Back at" />
          </label>
        </div>
      </div>
      <label className="field">
        <span className="label">Reason</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="e.g. bank, child's school, car service" />
      </label>
      <p className="muted small">
        At most {r.maxHours} hours, within office hours ({data.hours.start} to {data.hours.end}). Work the hours back after {data.hours.end} within{' '}
        {r.makeUpDays} days.
      </p>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const ok = await act.run(() => api.requestTimeSlip({ date, from, to, reason }), 'Time slip sent for approval.');
            if (ok) {
              setOpen(false);
              setReason('');
            }
          }}
        >
          Send for approval
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** On the staff member's own Clock screen: ask for a slip, see make-up progress, and approve slips given to them. */
export function MyTimeSlipSection() {
  const { data, error } = useLoad(() => api.myTimeSlips(), []);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="time slips" />;
  if (!data.allowed && data.toDecide.length === 0) return null;
  const r = data.rule.value;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Time slip</h3>
          <div className="muted small">
            Go out for up to {r.maxHours} hours for your own matters. Work the hours back after {data.hours.end} within {r.makeUpDays} days; hours not worked back are
            taken from annual leave in half days.
          </div>
        </div>
        {data.approver && <Chip tone="neutral">Approved by: {data.approver.label}</Chip>}
      </div>
      {data.toDecide.length > 0 && (
        <>
          <h4 style={{ margin: '4px 0' }}>Waiting for you to approve</h4>
          <div className="list">
            {data.toDecide.map((w) => (
              <DecideLine key={w.slip.id} w={w} />
            ))}
          </div>
        </>
      )}
      {data.allowed && <AskForm data={data} />}
      {data.mine.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 4px' }}>My time slips</h4>
          <div className="list">
            {data.mine.map((m) => (
              <div key={m.slip.id}>
                <SlipLine r={m} />
                {(m.slip.status === 'pending' || (m.slip.status === 'approved' && m.slip.date > todayMyt())) && (
                  <button className="btn btn-sm" style={{ margin: '0 0 8px' }} disabled={act.busy} onClick={() => act.run(() => api.cancelTimeSlip(m.slip.id), 'Time slip cancelled.')}>
                    Cancel this slip
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** HR changes who approves time slips, with a reason. */
function ApproverSetting({ b }: { b: TimeSlipBoard }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const cur = b.setting.approver;
  const next = cur === 'head' ? 'hr' : 'head';
  return (
    <section className="panel">
      <h3>Who approves time slips</h3>
      <p className="small">
        Now: <strong>{cur === 'head' ? 'the company head (company staff) or the department head (central staff)' : 'HR'}</strong>
        {b.setting.by ? ` · set by ${b.setting.by}${b.setting.note ? `: “${b.setting.note}”` : ''}` : ' · the default'}. HR is told of every approval either way.
      </p>
      {b.canSet && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason for the change" placeholder="Reason for the change" />
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.setTimeSlipApprover(next, note), 'Setting changed.')}>
            Change to {next === 'hr' ? 'HR approves' : 'company or department head approves'}
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

/** The time slip board for HR, group leaders and company managers. */
export function TimeSlipBoardView() {
  const { data, error } = useLoad(() => api.timeSlipBoard(), []);
  const act = useAction();
  const [filter, setFilter] = useState<'all' | 'owing' | 'leave' | 'new'>('all');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="time slips" />;
  const rows = data.rows.filter((v) =>
    filter === 'owing'
      ? v.slip.status === 'approved' && !v.slip.settlement && (v.makeUp?.leftMin ?? 0) > 0
      : filter === 'leave'
        ? (v.slip.settlement?.shortfallMin ?? 0) > 0
        : filter === 'new'
          ? v.unseen
          : true,
  );
  return (
    <>
      <div className="kpis">
        <Kpi label="Waiting for approval" value={data.counts.pending} tone={data.counts.pending ? 'warn' : 'ok'} />
        <Kpi label="Hours still to work back" value={hm(data.counts.owingMin)} note={`${data.counts.owing} slip${data.counts.owing === 1 ? '' : 's'}`} />
        <Kpi label="Taken from leave" value={data.counts.takenFromLeave} tone={data.counts.takenFromLeave ? 'warn' : 'ok'} />
        {data.canSet && <Kpi label="New for HR" value={data.counts.unseen} tone={data.counts.unseen ? 'info' : 'ok'} />}
      </div>
      {data.settled > 0 && <p className="notice">{data.settled} time slip(s) passed their 30 days just now and were closed.</p>}
      <ApproverSetting b={data} />
      {data.toDecide.length > 0 && (
        <section className="panel">
          <h3>Waiting for you to approve</h3>
          <div className="list">
            {data.toDecide.map((w) => (
              <DecideLine key={w.slip.id} w={w} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="seg" style={{ marginBottom: 8, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          <button aria-pressed={filter === 'owing'} onClick={() => setFilter('owing')}>
            Still to work back
          </button>
          <button aria-pressed={filter === 'leave'} onClick={() => setFilter('leave')}>
            Taken from leave
          </button>
          {data.canSet && (
            <button aria-pressed={filter === 'new'} onClick={() => setFilter('new')}>
              New for HR
            </button>
          )}
        </div>
        <div className="list">
          {rows.length === 0 && <div className="empty">No time slips here.</div>}
          {data.total > data.rows.length && (
            <div className="muted" style={{ fontSize: 12 }}>
              Showing every open slip and the newest closed ones ({data.rows.length} of {data.total}). The totals above count all {data.total}.
            </div>
          )}
          {rows.map((v) => (
            <div key={v.slip.id}>
              <SlipLine r={v} who />
              {v.unseen && (
                <button className="btn btn-sm" style={{ margin: '0 0 8px' }} disabled={act.busy} onClick={() => act.run(() => api.seenTimeSlip(v.slip.id))}>
                  Mark seen
                </button>
              )}
            </div>
          ))}
        </div>
        <ErrorNotice error={act.error} />
      </section>
    </>
  );
}
