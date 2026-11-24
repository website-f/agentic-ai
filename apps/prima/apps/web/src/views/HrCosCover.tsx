import { useState } from 'react';
import { api, type CosCoverView } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

const WHO: Record<string, string> = { dcos: 'Deputy Chief of Staff', hr_admin: 'HR Administrator' };

/**
 * HR gap D1 (Fauzan, 23 Nov 2026: "Yes and hr adminstrator. Cos can delegate what needed"): the items only the Chief of
 * Staff did. The Deputy stands in for all of them while the Chief of Staff is on approved leave; the Chief of Staff can
 * also hand any of them to the Deputy or the HR Administrator, for good or until a date. Every change needs a reason.
 */
export function CosCoverPanel() {
  const { data, error } = useLoad(() => api.cosCover(), []);
  if (error) return null;
  if (!data) return <Loading what="Chief of Staff cover" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Chief of Staff cover</h2>
        <Chip tone={data.cosOnLeave ? 'warn' : 'ok'}>{data.cosOnLeave ? 'Chief of Staff on leave today: the Deputy covers' : 'Chief of Staff at work'}</Chip>
      </div>
      {!data.installed && (
        <div className="muted small" style={{ padding: '8px 12px' }}>
          Handing work over needs the database module cos-cover-v1 (run by the CEO). Until then the Deputy still covers while the Chief of Staff is on
          approved leave.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Work</th>
              <th>Handed to</th>
              <th className="hide-sm">Until</th>
              <th className="hide-sm">Reason</th>
              <th>You act</th>
              {data.canSet && <th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <CoverRow key={it.item} it={it} canSet={data.canSet} />
            ))}
          </tbody>
        </table>
      </div>
      {data.history.length > 0 && (
        <details style={{ padding: '8px 12px' }}>
          <summary className="small">Changes ({data.history.length})</summary>
          <div className="list">
            {data.history.map((h) => (
              <div key={h.id} className="list-item small">
                {dateTimeLabel(h.at)} · {data.items.find((i) => i.item === h.item)?.label ?? h.item}:{' '}
                {h.to.length ? `to ${h.to.map((t) => WHO[t]).join(' and ')}${h.until ? ` until ${dateLabel(h.until)}` : ''}` : 'taken back'} by {h.by}. {h.reason}
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="muted small" style={{ padding: '8px 12px' }}>
        The Deputy covers everything while the Chief of Staff is on approved leave. The HR Administrator cannot open the PDPA and all-company
        office screens, so only the Deputy takes those two. Every step taken in cover is recorded as done for the Chief of Staff.
      </div>
    </section>
  );
}

function CoverRow({ it, canSet }: { it: CosCoverView['items'][number]; canSet: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string[]>(it.to);
  const [until, setUntil] = useState(it.until ?? '');
  const [reason, setReason] = useState('');
  const act = useAction();
  const toggle = (k: string) => setTo((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <>
      <tr>
        <td>{it.label}</td>
        <td>{it.to.length ? it.to.map((t) => WHO[t]).join(' and ') : <span className="muted">Chief of Staff only</span>}</td>
        <td className="hide-sm">{it.to.length ? (it.until ? dateLabel(it.until) : 'Until changed') : ''}</td>
        <td className="hide-sm small">{it.reason ?? ''}</td>
        <td>{it.iAct ? <Chip tone="ok">Yes</Chip> : <span className="muted small">No</span>}</td>
        {canSet && (
          <td>
            {!open && (
              <button className="btn btn-sm" onClick={() => setOpen(true)}>
                Change
              </button>
            )}
          </td>
        )}
      </tr>
      {canSet && open && (
        <tr>
          <td colSpan={6}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <label className="small">
                <input type="checkbox" checked={to.includes('dcos')} onChange={() => toggle('dcos')} /> Deputy Chief of Staff
              </label>
              {!it.dcosOnly && (
                <label className="small">
                  <input type="checkbox" checked={to.includes('hr_admin')} onChange={() => toggle('hr_admin')} /> HR Administrator
                </label>
              )}
              <label className="small">
                Last day{' '}
                <input className="input" type="date" aria-label="Last day" value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
              <input className="input" aria-label="Reason" placeholder="Reason (needed)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <ErrorNotice error={act.error} />
            <div className="row">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || reason.trim().length < 3}
                onClick={() =>
                  act
                    .run(() => api.setCosCover({ item: it.item, to, until: until || null, reason }), to.length ? 'Handed over.' : 'Taken back.')
                    .then((r) => {
                      if (r !== undefined) setOpen(false);
                    })
                }
              >
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
