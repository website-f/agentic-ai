import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type MyOtClaims } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';

/**
 * A9 (Fitri package): office staff claim overtime already worked; the head who approves their time slips approves it
 * with a comment. The staff payroll run pays it only while HR has overtime switched on for that person (rule HR-OT).
 */
const KIND = { normal: 'Normal day', restDay: 'Rest day', publicHoliday: 'Public holiday' } as const;
const STATUS_TONE = { pending: 'warn', approved: 'ok', refused: 'crit', cancelled: 'neutral' } as const;

type Claim = MyOtClaims['mine'][number];

function DecideLine({ c }: { c: Claim }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="item">
      <strong>{c.userName}</strong> · {c.date} · {c.hours} hours · {KIND[c.kind]}
      <div className="muted small">{c.reason}</div>
      <div className="row" style={{ gap: 6 }}>
        <input placeholder="Comment (needed)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Comment" />
        <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.decideOtClaim(c.id, true, note), 'Overtime approved.')}>
          Approve
        </button>
        <button className="btn btn-sm btn-ghost" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.decideOtClaim(c.id, false, note), 'Overtime refused.')}>
          Refuse
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
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
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Overtime</h3>
          <div className="muted small">
            Claim overtime you have worked, within 30 days. {data.paidForMe ? 'HR has overtime on for you: approved hours are paid in the monthly run.' : 'HR has not switched overtime on for you: an approved claim is recorded but not paid.'}
          </div>
        </div>
        <Chip tone={data.overtimeOn ? 'ok' : 'neutral'}>{data.overtimeOn ? 'Overtime on (HR)' : 'Overtime off (HR)'}</Chip>
      </div>
      {data.toDecide.length > 0 && (
        <>
          <h4 style={{ margin: '4px 0' }}>Waiting for you to approve</h4>
          <div className="list">
            {data.toDecide.map((c) => (
              <DecideLine key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
      {data.allowed && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Day worked" />
          <input type="number" min={0.5} max={4} step={0.5} value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })} aria-label="Hours" />
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as keyof typeof KIND })} aria-label="Kind of day">
            {Object.entries(KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <input placeholder="What work needed the extra hours" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-label="Overtime work done" />
          <button className="btn btn-sm" disabled={act.busy || !f.date || !f.reason.trim()} onClick={() => act.run(() => api.requestOtClaim(f), 'Overtime claim sent.')}>
            Claim
          </button>
        </div>
      )}
      {data.mine.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {data.mine.map((c) => (
            <div className="item" key={c.id}>
              {c.date} · {c.hours} hours · {KIND[c.kind]} <Chip tone={STATUS_TONE[c.status]}>{c.status}</Chip>
              {c.decidedBy && <span className="muted small"> by {c.decidedBy}: {c.decisionNote}</span>}
              {c.status === 'pending' && (
                <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => act.run(() => api.cancelOtClaim(c.id), 'Claim withdrawn.')}>
                  Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
