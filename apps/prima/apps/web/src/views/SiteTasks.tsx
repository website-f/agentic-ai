import { Select } from '../SearchSelect';
import { useState } from 'react';
import { CLIENT_NEEDS, NEED_TOPICS, SITE_TASK_FOR_LABEL, type NeedConcern, type NeedTopic, type SiteTaskFor } from '@prima/core';
import { api, type SiteTaskBoard } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad, type Tone } from '../ui';
import { ClientCodesPanel } from './ClientCodes';

/**
 * The OM's page for one site (Fauzan, 6 Nov 2026): what to discuss with the client to learn what the site needs and
 * what can be done; the record of each discussion; and the tasks set from it for the patrolling officer, the officer
 * or the guard, which show on the site's shared device on the days they are due.
 */

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CONCERN_TONE: Record<NeedConcern, Tone> = { none: 'neutral', low: 'ok', medium: 'warn', high: 'crit' };
type Week = SiteTaskBoard['tasks'][number]['week'][number];
const CELL: Record<Week['state'], { t: string; tone: Tone }> = {
  done: { t: '✓', tone: 'ok' },
  done_late: { t: '✓ sent later', tone: 'warn' },
  not_done: { t: '✗', tone: 'warn' },
  missed: { t: '!', tone: 'crit' },
  late: { t: 'late', tone: 'crit' },
  open: { t: '…', tone: 'info' },
  not_due: { t: '', tone: 'neutral' },
};
const topicTitle = (k: string | null) => NEED_TOPICS.find((t) => t.key === k)?.title ?? '';

export function SiteTasksView({ siteId }: { siteId: string }) {
  const board = useLoad(() => api.siteTaskBoard(siteId), [siteId]);
  const [mode, setMode] = useState<'board' | 'discuss' | 'task'>('board');
  const [idea, setIdea] = useState<{ topic: NeedTopic; i: number } | null>(null);
  if (board.error) return <ErrorNotice error={board.error} />;
  if (!board.data) return <Loading what="site tasks" />;
  const d = board.data;
  if (mode === 'discuss') return <NeedsForm siteId={siteId} onDone={() => setMode('board')} onIdea={(topic, i) => (setIdea({ topic, i }), setMode('task'))} />;
  if (mode === 'task') return <TaskForm siteId={siteId} idea={idea} onDone={() => (setIdea(null), setMode('board'))} />;
  const last = d.reviews[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {d.canSet ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setMode('discuss')}>
            Discuss needs with the client
          </button>
          <button className="btn" onClick={() => setMode('task')}>
            Set a task
          </button>
        </div>
      ) : (
        <span className="muted small">Set by the Operations Manager who covers this site. You can see them here.</span>
      )}
      <GateSwitch siteId={siteId} gate={d.gateLog} canSet={d.canSet} />
      <section className="panel">
        <div className="panel-head">
          <h3>What the client needs</h3>
          <span className="muted small">{last ? `Last discussed ${last.at.slice(0, 10)} with ${last.clientContact}` : 'Not discussed yet'}</span>
        </div>
        {last ? (
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="small">
              <b>Agreed:</b> {last.agreed}
            </div>
            {Object.entries(last.answers).map(([k, v]) => (
              <div key={k} className="small">
                <Chip tone={CONCERN_TONE[v.concern]}>{v.concern === 'none' ? 'Noted' : `${v.concern[0].toUpperCase()}${v.concern.slice(1)} concern`}</Chip> <b>{topicTitle(k)}:</b> {v.answer}
              </div>
            ))}
            <span className="muted small">By {last.by.name}. Earlier discussions are kept.</span>
          </div>
        ) : (
          <div className="empty">Use "Discuss needs with the client" at the first meeting.</div>
        )}
      </section>
      <ClientCodesPanel siteId={siteId} />
      <section className="panel">
        <div className="panel-head">
          <h3>Site tasks</h3>
          <span className="muted small">Shown on the shared device on the days they are due</span>
        </div>
        <div className="list">
          {d.tasks.length === 0 && <div className="empty">No tasks yet.</div>}
          {d.tasks.map((t) => (
            <div key={t.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, ...(t.status === 'stopped' ? { opacity: 0.55 } : {}) }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div className="muted small">
                    {t.ref} · {SITE_TASK_FOR_LABEL[t.forRole]} · {t.onDate ? `on ${t.onDate}` : t.days.length === 7 ? 'daily' : t.days.map((x) => DAY[x]).join(' ')}
                    {t.byTime ? ` by ${t.byTime}` : ''}
                    {t.proof === 'photo' ? ' · photo' : ''}
                    {t.needTopic ? ` · for: ${topicTitle(t.needTopic)}` : ''}
                    {t.status === 'stopped' && t.stopped ? ` · stopped: ${t.stopped.reason}` : ''}
                  </div>
                </div>
                {d.canSet && t.status === 'active' && <StopButton id={t.id} />}
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {t.week.map((w) => (
                  <span
                    key={w.date}
                    title={`${w.date}${w.by ? `: ${w.by}` : ''}${w.note ? ` (${w.note})` : ''}`}
                    style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}
                  >
                    <span className="muted small">
                      {DAY[new Date(`${w.date}T00:00:00Z`).getUTCDay()]} {w.date.slice(8)}
                    </span>
                    {CELL[w.state].t ? <Chip tone={CELL[w.state].tone}>{CELL[w.state].t}</Chip> : <span className="muted small">·</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="muted small" style={{ padding: '8px 12px' }}>
          ✓ done · ✓ sent later = signed off from an old device time, check it · ✗ not done (reason given) · ! missed · late = past its time today
        </div>
      </section>
    </div>
  );
}

function StopButton({ id }: { id: string }) {
  const act = useAction();
  return (
    <button
      className="btn btn-sm btn-ghost"
      disabled={act.busy}
      onClick={() => {
        const reason = window.prompt('Why does this task stop?');
        if (reason) void act.run(() => api.stopSiteTask(id, reason), 'Task stopped');
      }}
    >
      Stop
    </button>
  );
}

/** The discussion with the client: each topic's questions, what can be done, and the client's answer. */
function NeedsForm({ siteId, onDone, onIdea }: { siteId: string; onDone: () => void; onIdea: (topic: NeedTopic, i: number) => void }) {
  const [contact, setContact] = useState('');
  const [answers, setAnswers] = useState<Record<string, { answer: string; concern: NeedConcern }>>({});
  const [agreed, setAgreed] = useState('');
  const act = useAction();
  const set = (k: string, v: Partial<{ answer: string; concern: NeedConcern }>) => setAnswers((a) => ({ ...a, [k]: { answer: a[k]?.answer ?? '', concern: a[k]?.concern ?? 'none', ...v } }));
  const filled = Object.values(answers).filter((v) => v.answer.trim() || v.concern !== 'none').length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Discuss needs with the client</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="muted small">Go through each area with the client. Write what they say and how worried they are. Skip what does not apply.</span>
        <label className="field">
          <span className="label">Who you spoke to at the client</span>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. Facility manager, Encik ..." />
        </label>
        {CLIENT_NEEDS.map((sec, si) => (
          <details key={sec.key} open={si === 0} className="panel" style={{ padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {si + 1}. {sec.title}
            </summary>
            {sec.topics.map((t) => (
              <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div className="small">
                  <span className="label">Ask</span>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {t.ask.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
                <div className="small">
                  <span className="label">What we can do</span>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {t.canDo.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
                <textarea className="textarea" aria-label={`Client answer: ${t.title}`} value={answers[t.key]?.answer ?? ''} maxLength={600} onChange={(e) => set(t.key, { answer: e.target.value })} placeholder="What the client said" />
                <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} aria-label={`Concern: ${t.title}`}>
                  {(['none', 'low', 'medium', 'high'] as const).map((c) => (
                    <button key={c} aria-pressed={(answers[t.key]?.concern ?? 'none') === c} onClick={() => set(t.key, { concern: c })}>
                      {c === 'none' ? 'No concern' : c[0].toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
                {t.tasks.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span className="muted small">Task ideas:</span>
                    {t.tasks.map((x, i) => (
                      <button key={x.title} className="btn btn-sm" onClick={() => onIdea(t, i)} title="Set this as a task (save the discussion first)">
                        {x.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </details>
        ))}
        <label className="field">
          <span className="label">What was agreed with the client</span>
          <textarea className="textarea" value={agreed} maxLength={2000} onChange={(e) => setAgreed(e.target.value)} placeholder="e.g. Fence round every night with photo, officer check daily, lock-up round at 7.30 pm" />
        </label>
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || contact.trim().length < 3 || !filled || agreed.trim().length < 5}
          onClick={async () => {
            if (await act.run(() => api.saveNeedsReview(siteId, { clientContact: contact, answers, agreed }), 'Client discussion saved')) onDone();
          }}
        >
          Save discussion ({filled} topics)
        </button>
        <span className="muted small">Then set tasks from what was agreed. Task ideas open the task form ready filled; save the discussion first.</span>
      </div>
    </section>
  );
}

/** A task for the guard, officer or patrolling officer: what, which days, by what time, and whether a photo is needed. */
function TaskForm({ siteId, idea, onDone }: { siteId: string; idea: { topic: NeedTopic; i: number } | null; onDone: () => void }) {
  const pre = idea ? idea.topic.tasks[idea.i] : null;
  const preDays = !pre ? [0, 1, 2, 3, 4, 5, 6] : pre.days === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : pre.days === 'weekdays' ? [1, 2, 3, 4, 5] : [1];
  const [title, setTitle] = useState(pre?.title ?? '');
  const [detail, setDetail] = useState('');
  const [forRole, setForRole] = useState<SiteTaskFor>(pre?.forRole ?? 'guard');
  const [once, setOnce] = useState(false);
  const [onDate, setOnDate] = useState('');
  const [days, setDays] = useState<number[]>(preDays);
  const [byTime, setByTime] = useState(pre?.byTime ?? '');
  const [photo, setPhoto] = useState(pre ? pre.proof === 'photo' : true);
  const [needTopic, setNeedTopic] = useState(idea?.topic.key ?? '');
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Set a task</h2>
        <button className="btn btn-ghost" onClick={onDone}>
          Back
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          <span className="label">What has to be done</span>
          <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Detail (optional)</span>
          <textarea className="textarea" value={detail} maxLength={600} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <div className="field">
          <span className="label">Who does it</span>
          <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {(['guard', 'officer', 'patrol_officer'] as const).map((r) => (
              <button key={r} aria-pressed={forRole === r} onClick={() => setForRole(r)}>
                {SITE_TASK_FOR_LABEL[r]}
              </button>
            ))}
          </div>
          <span className="muted small">An officer may also do a guard task; a patrolling officer may do any.</span>
        </div>
        <div className="field">
          <span className="label">When</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button aria-pressed={!once} onClick={() => setOnce(false)}>
              Repeats
            </button>
            <button aria-pressed={once} onClick={() => setOnce(true)}>
              Once
            </button>
          </div>
          {once ? (
            <input className="input" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} aria-label="Date" />
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((x) => (
                <button key={x} className={days.includes(x) ? 'btn btn-sm btn-primary' : 'btn btn-sm'} aria-pressed={days.includes(x)} onClick={() => setDays((d) => (d.includes(x) ? d.filter((y) => y !== x) : [...d, x]))}>
                  {DAY[x]}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          <span className="label">Do by (optional)</span>
          <input className="input" type="time" value={byTime} onChange={(e) => setByTime(e.target.value)} />
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
          A stamped photo is needed as proof
        </label>
        <label className="field">
          <span className="label">Client need it answers (optional)</span>
          <Select className="select" value={needTopic} onChange={(e) => setNeedTopic(e.target.value)}>
            <option value="">None</option>
            {NEED_TOPICS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.title}
              </option>
            ))}
          </Select>
        </label>
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || title.trim().length < 4 || (once ? !onDate : !days.length)}
          onClick={async () => {
            const r = await act.run(
              () =>
                api.setSiteTask(siteId, {
                  title,
                  detail,
                  forRole,
                  days: once ? [] : days,
                  onDate: once ? onDate : null,
                  byTime: byTime || null,
                  proof: photo ? 'photo' : 'none',
                  needTopic: needTopic || null,
                }),
              'Task set. It shows on the site device on its days.',
            );
            if (r) onDone();
          }}
        >
          Set task
        </button>
      </div>
    </section>
  );
}

/** The OM turns visitor and vehicle check-in on the shared device on or off for the site. */
function GateSwitch({ siteId, gate, canSet }: { siteId: string; gate: SiteTaskBoard['gateLog']; canSet: boolean }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Visitor and vehicle check-in on the shared device</h3>
        <Chip tone={gate.on ? 'ok' : 'neutral'}>{gate.on ? 'On' : 'Off'}</Chip>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="muted small">
          {gate.on ? 'Guards record visitors and vehicles on the shared device.' : 'Off: the site records its gate on its own desktop system. The device does not show the gate.'}
          {gate.by ? ` Last changed by ${gate.by} on ${gate.at?.slice(0, 10)}: ${gate.reason}` : ''}
        </span>
        {canSet &&
          (open ? (
            <>
              <label className="field">
                <span className="label">{gate.on ? 'How the site records its gate instead' : 'Why the device should record the gate'}</span>
                <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={gate.on ? 'e.g. Client desktop visitor system at the lobby' : 'e.g. Desktop system removed'} />
              </label>
              <ErrorNotice error={act.error} />
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={act.busy || reason.trim().length < 3}
                  onClick={async () => {
                    if (await act.run(() => api.setGateLog(siteId, !gate.on, reason), gate.on ? 'Gate check-in turned off' : 'Gate check-in turned on')) (setOpen(false), setReason(''));
                  }}
                >
                  {gate.on ? 'Turn off' : 'Turn on'}
                </button>
                <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
              {gate.on ? 'Turn off for this site' : 'Turn on for this site'}
            </button>
          ))}
      </div>
    </section>
  );
}
