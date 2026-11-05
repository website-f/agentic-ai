import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';

/**
 * Central Admin 5E (Fauzan, 2 Nov 2026): the weekly Director Office digest, put together from what is already keyed in,
 * and CEO instructions tracked to done. The CEO gives an instruction, or the Director Office records it for the CEO; it
 * lands in the owner's own task list and the CEO accepts the result with a reason.
 */
export function DirectorDesk() {
  const { go } = useApp();
  const digest = useLoad(() => api.directorDigest().catch(() => null), []);
  const instr = useLoad(() => api.ceoInstructions().catch(() => null), []);
  const legal = useLoad(() => api.directorLegalFlags().catch(() => null), []);
  if (digest.error) return <ErrorNotice error={digest.error} />;
  if (digest.loading && !digest.data) return <Loading what="weekly digest" />;
  return (
    <>
      <CentralAdminGuide view="doa" />
      {digest.data && (
        <section className="panel">
          <div className="panel-head">
            <h3>This week</h3>
            <span className="muted small">
              {dateLabel(digest.data.week.from)} to {dateLabel(digest.data.week.to)} · put together from what is keyed in
            </span>
          </div>
          <div className="kpis">
            {digest.data.lines.map((l) => (
              <button key={l.key} className="list-button" onClick={() => go({ view: l.go as never })}>
                <Kpi label={l.label} value={l.value} tone={l.tone} />
              </button>
            ))}
          </div>
          {digest.data.meetings.length > 0 && (
            <ul className="small">
              {digest.data.meetings.slice(0, 10).map((m) => (
                <li key={m.id}>
                  {m.start.slice(0, 16).replace('T', ' ')} · {m.title} · {m.companyName}
                  {m.prepState === 'late' ? ' · pre-brief late' : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {legal.data && <LegalFlags data={legal.data} />}
      {instr.data && <Instructions data={instr.data} reload={instr.reload} />}
    </>
  );
}

function Instructions({ data, reload }: { data: NonNullable<Awaited<ReturnType<typeof api.ceoInstructions>>>; reload: () => void }) {
  const act = useAction();
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [due, setDue] = useState('');
  const [all, setAll] = useState(false);
  const rows = data.rows.filter((r) => all || r.state !== 'accepted');
  const TONE = {
    overdue: 'crit',
    open: 'info',
    returned: 'warn',
    waiting_review: 'warn',
    accepted: 'ok',
  } as const;
  const LABEL = {
    overdue: 'Overdue',
    open: 'Open',
    returned: 'Returned to fix',
    waiting_review: 'Done, waiting for the CEO',
    accepted: 'Accepted',
  } as const;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>CEO instructions</h3>
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide accepted' : 'Show accepted'}
        </button>
      </div>
      <div className="kpis">
        <Kpi label="Overdue" value={data.totals.overdue} tone={data.totals.overdue ? 'crit' : 'ok'} />
        <Kpi label="Open" value={data.totals.open} />
        <Kpi label="Waiting for the CEO" value={data.totals.waiting} tone={data.totals.waiting ? 'warn' : 'ok'} />
        <Kpi label="Done" value={data.totals.done} tone="ok" />
      </div>
      <div className="row">
        <select aria-label="Who" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Who does it</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input aria-label="Instruction" placeholder="The instruction" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="Done means" placeholder='What "done" looks like' value={doneMeans} onChange={(e) => setDoneMeans(e.target.value)} />
        <input aria-label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <button
          className="btn btn-sm"
          disabled={act.busy || !userId || !due}
          onClick={() =>
            act.run(
              () =>
                api
                  .ceoInstruct({
                    userId,
                    title,
                    doneMeans,
                    dueAt: new Date(due).toISOString(),
                    priority: 'high',
                  })
                  .then(() => {
                    setTitle('');
                    setDoneMeans('');
                    reload();
                  }),
              'Instruction given.',
            )
          }
        >
          Give instruction
        </button>
      </div>
      {act.error && <p className="error small">{act.error.message}</p>}
      <div className="list">
        {!rows.length && <div className="empty">No open instructions.</div>}
        {rows.map((r) => (
          <div className="item" key={r.task.id}>
            <div className="item-main">
              <strong>{r.task.title}</strong>
              <div className="muted small">
                {r.task.userName} · due {r.dueAt.slice(0, 16).replace('T', ' ')} · done means: {r.task.doneMeans} · from {r.task.assignedBy}
              </div>
              {r.task.evidence && <div className="small">Result: {r.task.evidence.note}</div>}
            </div>
            <Chip tone={TONE[r.state]}>{LABEL[r.state]}</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Legal flags for the directors only (Arisha main review, 2 Nov 2026). Staff screens show the work to do; the directors
 * see the legal point, its source, the records it touches, who answers for it, its status and the audit trail. An open
 * point is never shown as compliant.
 */
function LegalFlags({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.directorLegalFlags>>> }) {
  const [open, setOpen] = useState('');
  return (
    <section className="panel" aria-label="Legal flags">
      <div className="panel-head">
        <h3>Legal flags</h3>
        <span className="muted small">Directors only · {data.totals.open} open · not confirmed compliant until resolved</span>
      </div>
      {!data.rows.length && <p className="muted small">No open legal flags in the records you can see.</p>}
      <div className="list">
        {data.rows.map((r) => (
          <div className="item" key={r.id}>
            <div className="item-main">
              <strong>{r.title}</strong>
              <div className="muted small">
                Source: {r.source} · since {dateLabel(r.since)} · responsible: {r.responsible}
                {r.responsibleAssumed ? ' (assumed, to confirm)' : ''}
              </div>
              <div className="small">
                {r.detail} Records: {r.records.map((x) => x.label).join('; ')}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === r.id ? '' : r.id)}>
                {open === r.id ? 'Hide history' : `History (${r.history.length})`}
              </button>
              {open === r.id && (
                <ul className="small">
                  {r.history.map((h, i) => (
                    <li key={i}>
                      {h.at.slice(0, 16).replace('T', ' ')} · {h.actor} · {h.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Chip tone="warn">Open</Chip>
          </div>
        ))}
      </div>
    </section>
  );
}
