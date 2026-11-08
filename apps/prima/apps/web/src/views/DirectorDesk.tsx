import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, dateLabel, n, useAction, useLoad } from '../ui';
import { Card, Empty, Person, Stat, Stats } from '../kit';
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
      {digest.data && (
        <Card
          title="This week"
          sub={`${dateLabel(digest.data.week.from)} to ${dateLabel(digest.data.week.to)} · put together from what is keyed in`}
        >
          <div className="ld-stack">
            <Stats>
              {digest.data.lines.map((l) => (
                <Stat
                  key={l.key}
                  label={l.label}
                  value={n(l.value)}
                  tone={l.tone}
                  onClick={() => go({ view: l.go as never })}
                />
              ))}
            </Stats>
            {digest.data.meetings.length > 0 && (
              <ul className="ld-mini">
                {digest.data.meetings.slice(0, 10).map((m) => (
                  <li key={m.id}>
                    <span className="mono small ld-mini-when">{m.start.slice(0, 16).replace('T', ' ')}</span>
                    <span className="ld-mini-what">
                      {m.title} <span className="muted">· {m.companyName}</span>
                    </span>
                    {m.prepState === 'late' && <Chip tone="crit">pre-brief late</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
      {instr.data && <Instructions data={instr.data} reload={instr.reload} />}
      {legal.data && <LegalFlags data={legal.data} />}
      <CentralAdminGuide view="doa" />
    </>
  );
}

/** The CEO accepts a finished instruction with a reason, or returns it with what to fix (the server checks who may). */
function ReviewResult({ taskId, reload }: { taskId: string; reload: () => void }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const decide = (accept: boolean) =>
    act.run(() => api.workTaskReview(taskId, accept, note).then(reload), accept ? 'Accepted.' : 'Returned to fix.');
  return (
    <span className="ld-row-full ld-inline-add">
      <input className="input" aria-label="Reason" placeholder="Reason (to return it, say what to fix)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => decide(true)}>
        Accept
      </button>
      <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => decide(false)}>
        Return to fix
      </button>
      {act.error && <span className="error small">{act.error.message}</span>}
    </span>
  );
}

function Instructions({ data, reload }: { data: NonNullable<Awaited<ReturnType<typeof api.ceoInstructions>>>; reload: () => void }) {
  const { me } = useApp();
  const ceo = me.user.opsTier === 'ceo';
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
    <Card
      title="CEO instructions"
      actions={
        <button className="btn btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Hide accepted' : 'Show accepted'}
        </button>
      }
    >
      <div className="ld-stack">
        <Stats>
          <Stat label="Overdue" value={data.totals.overdue} tone={data.totals.overdue ? 'crit' : 'ok'} />
          <Stat label="Open" value={data.totals.open} />
          <Stat label="Waiting for the CEO" value={data.totals.waiting} tone={data.totals.waiting ? 'warn' : 'ok'} />
          <Stat label="Done" value={data.totals.done} tone="ok" />
        </Stats>

        <div className="ld-subpanel">
          <h3>Give an instruction</h3>
          <div className="ld-form ld-form-4">
            <label className="field">
              <span className="label">Who</span>
              <Select className="select" aria-label="Who" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Who does it</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span className="label">Instruction</span>
              <input className="input" aria-label="Instruction" placeholder="The instruction" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Done means</span>
              <input
                className="input"
                aria-label="Done means"
                placeholder='What "done" looks like'
                value={doneMeans}
                onChange={(e) => setDoneMeans(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Due</span>
              <input className="input" aria-label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          {act.error && (
            <p className="notice" data-tone="crit">
              {act.error.message}
            </p>
          )}
          <div className="ld-actions">
            <button
              className="btn btn-sm btn-primary"
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
        </div>

        {!rows.length ? (
          <Empty title="No open instructions." />
        ) : (
          <ul className="ld-rows ld-rows-boxed">
            {rows.map((r) => (
              <li className="ld-row" key={r.task.id} data-tone={TONE[r.state]}>
                <span className="ld-row-main">
                  <span className="ld-row-title">{r.task.title}</span>
                  <span className="ld-row-meta">
                    due {r.dueAt.slice(0, 16).replace('T', ' ')} · done means: {r.task.doneMeans} · from {r.task.assignedBy}
                  </span>
                  {r.task.evidence && <span className="ld-row-text">Result: {r.task.evidence.note}</span>}
                  <Person name={r.task.userName} size={24} />
                </span>
                <span className="ld-row-aside">
                  <Chip tone={TONE[r.state]}>{LABEL[r.state]}</Chip>
                </span>
                {ceo && r.state === 'waiting_review' && <ReviewResult taskId={r.task.id} reload={reload} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * Legal flags for the directors only (main review, 2 Nov 2026). Staff screens show the work to do; the directors
 * see the legal point, its source, the records it touches, who answers for it, its status and the audit trail. An open
 * point is never shown as compliant.
 */
function LegalFlags({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.directorLegalFlags>>> }) {
  const [open, setOpen] = useState('');
  return (
    <section className="k-card" aria-label="Legal flags">
      <div className="k-card-head">
        <div className="k-card-title">
          <h2>Legal flags</h2>
          <p>Directors only · {data.totals.open} open · not confirmed compliant until resolved</p>
        </div>
        <Chip tone={data.totals.open ? 'warn' : 'ok'}>{data.totals.open}</Chip>
      </div>
      {!data.rows.length ? (
        <Empty title="No open legal flags in the records you can see." />
      ) : (
        <ul className="ld-rows">
          {data.rows.map((r) => (
            <li className="ld-row ld-flag" key={r.id} data-tone="warn">
              <span className="ld-row-main">
                <span className="ld-row-title">{r.title}</span>
                <span className="ld-row-meta">
                  Source: {r.source} · since {dateLabel(r.since)} · responsible: {r.responsible}
                  {r.responsibleAssumed ? ' (assumed, to confirm)' : ''}
                </span>
                <span className="ld-row-text">
                  {r.detail} Records: {r.records.map((x) => x.label).join('; ')}
                </span>
                <span>
                  <button className="btn btn-sm btn-ghost ld-flag-history" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? '' : r.id)}>
                    {open === r.id ? 'Hide history' : `History (${r.history.length})`}
                  </button>
                </span>
                {open === r.id && (
                  <ul className="ld-mini">
                    {r.history.map((h, i) => (
                      <li key={i}>
                        <span className="mono small ld-mini-when">{h.at.slice(0, 16).replace('T', ' ')}</span>
                        <span className="ld-mini-what">
                          {h.actor} · {h.summary}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
              <span className="ld-row-aside">
                <Chip tone="warn">Open</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
