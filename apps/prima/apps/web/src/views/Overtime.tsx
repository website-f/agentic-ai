import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type MyOtClaims } from '../api';
import { Card, Empty } from '../kit';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';

/**
 * A9 (Fitri package): office staff claim overtime already worked; the head who approves their time slips approves it
 * with a comment. The staff payroll run pays it only while HR has overtime switched on for that person (rule HR-OT).
 * P105: office kit card, labelled fields, plain status words and BM rows; the flow and the checks are unchanged.
 */
const KIND = { normal: 'Normal day', restDay: 'Rest day', publicHoliday: 'Public holiday' } as const;
const STATUS_TONE = { pending: 'warn', approved: 'ok', refused: 'crit', cancelled: 'neutral' } as const;
const STATUS_WORD = { pending: 'Waiting for your head', approved: 'Approved', refused: 'Refused', cancelled: 'Withdrawn' } as const;

type Claim = MyOtClaims['mine'][number];

function DecideLine({ c }: { c: Claim }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <li className="hx-row">
      <div className="hx-row-main">
        <span className="hx-row-title">{c.userName}</span>
        <span className="hx-row-meta">
          {c.date} · {c.hours} h · {KIND[c.kind]}
        </span>
        <span className="hx-row-text">{c.reason}</span>
      </div>
      <div className="hx-row-body">
        <div className="hx-form">
          <label className="field">
            <span className="label">Your comment (needed)</span>
            <input className="input" placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Comment" />
          </label>
          <div className="hx-form-actions">
            <button className="btn btn-primary btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.decideOtClaim(c.id, true, note), 'Overtime approved.')}>
              Approve
            </button>
            <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.decideOtClaim(c.id, false, note), 'Overtime refused.')}>
              Refuse
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      </div>
    </li>
  );
}

export function MyOvertimeSection() {
  const { data, error } = useLoad(() => api.myOtClaims(), []);
  const [f, setF] = useState({ date: '', hours: 1, kind: 'normal' as keyof typeof KIND, reason: '' });
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="overtime" />;
  if (!data.allowed && data.toDecide.length === 0) return null;
  return (
    <Card
      title="Overtime"
      sub={`Claim overtime you have worked, within 30 days. ${data.paidForMe ? 'HR has overtime on for you: approved hours are paid in the monthly run.' : 'HR has not switched overtime on for you: an approved claim is recorded but not paid.'}`}
      actions={<Chip tone={data.overtimeOn ? 'ok' : 'neutral'}>{data.overtimeOn ? 'Overtime on (HR)' : 'Overtime off (HR)'}</Chip>}
    >
      <div className="hx-stack-tight">
        {data.toDecide.length > 0 && (
          <>
            <h3 className="hx-form-title">Waiting for you to approve</h3>
            <ul className="hx-rows">
              {data.toDecide.map((c) => (
                <DecideLine key={c.id} c={c} />
              ))}
            </ul>
          </>
        )}
        {data.allowed && (
          <div className="hx-form">
            <h3 className="hx-form-title">Claim overtime</h3>
            <div className="hx-form-grid">
              <label className="field">
                <span className="label">Day worked</span>
                <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Day worked" />
              </label>
              <label className="field">
                <span className="label">Hours (half-hours, up to 4)</span>
                <input className="input" type="number" min={0.5} max={4} step={0.5} value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })} aria-label="Hours" />
              </label>
              <label className="field">
                <span className="label">Kind of day</span>
                <Select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as keyof typeof KIND })} aria-label="Kind of day">
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field hx-form-wide">
                <span className="label">What work needed the extra hours</span>
                <input className="input" placeholder="For example: month-end payroll files" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Overtime work done" />
              </label>
            </div>
            <div className="hx-form-actions">
              <button className="btn btn-primary btn-sm" disabled={act.busy || !f.date || !f.reason.trim()} onClick={() => act.run(() => api.requestOtClaim(f), 'Overtime claim sent.')}>
                Claim
              </button>
              <span className="small muted">Your head who approves your time slips decides it.</span>
            </div>
          </div>
        )}
        {data.allowed &&
          (data.mine.length > 0 ? (
            <ul className="hx-rows">
              {data.mine.map((c) => (
                <li className="hx-row" key={c.id}>
                  <div className="hx-row-main">
                    <span className="hx-row-title">
                      {c.date} · {c.hours} h · {KIND[c.kind]}
                    </span>
                    {c.decidedBy && (
                      <span className="hx-row-meta">
                        {c.decidedBy}: {c.decisionNote}
                      </span>
                    )}
                  </div>
                  <div className="hx-row-side">
                    <Chip tone={STATUS_TONE[c.status]}>{STATUS_WORD[c.status] ?? c.status}</Chip>
                    {c.status === 'pending' && (
                      <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => act.run(() => api.cancelOtClaim(c.id), 'Claim withdrawn.')}>
                        Withdraw
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No overtime claims yet." />
          ))}
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}
