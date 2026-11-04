import { useState } from 'react';
import { hasOwnStaffRecord, isGroupLeader, type ScoreState } from '@prima/core';
import { api, type BranchWork, type MyWork, type PersonWork, type TeamWork, type WorkSummary } from '../api';
import { useApp } from '../App';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { EvidenceCamera } from './Camera';
import { CooNoticesPanel } from './CooNotices';
import { Readiness } from './Remote';

type Task = MyWork['open'][number];

const STATE: Record<Task['state'], { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'crit' },
  returned: { label: 'Returned to fix', tone: 'warn' },
  waiting_review: { label: 'Waiting for review', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'ok' },
};
const SOURCE: Record<Task['source'], string> = { playbook: 'Playbook', assigned: 'From manager', meeting: 'From a meeting', own: 'Own task' };
const SCORE: Record<ScoreState, { label: string; tone: Tone }> = {
  green: { label: 'Green', tone: 'ok' },
  amber: { label: 'Amber', tone: 'warn' },
  red: { label: 'Red', tone: 'crit' },
  unknown: { label: 'UNKNOWN', tone: 'neutral' },
};
const EVERY = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const;
const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** A date and time typed in Malaysia time, as an ISO time. */
const fromLocal = (v: string) => new Date(`${v}:00+08:00`).toISOString();
const localIn = (days: number, hm = '17:00') => `${new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)}T${hm}`;
const due = (t: Task) => `${dateLabel(t.effectiveDueAt.slice(0, 10))} ${hhmm(t.effectiveDueAt)}`;

/**
 * Work (Fauzan, 27 Oct 2026): everyone sees what to do and what "done" means (role playbook and manager tasks), sends a
 * morning check-in, finishes tasks with proof, and asks for help when stuck. Managers see exceptions first; group
 * leadership gets the Monday summary. Tasks are also kept in Microsoft Planner, which is preferred.
 */
export function WorkView() {
  const { me } = useApp();
  const own = hasOwnStaffRecord(me.user);
  const leader = isGroupLeader(me.user);
  const team = useLoad(() => api.teamWork(), []);
  const hasTeam = (team.data?.people.length ?? 0) > 0 || (team.data?.help.length ?? 0) > 0;
  const tabs: { key: 'mine' | 'team' | 'summary'; label: string }[] = [
    ...(own ? [{ key: 'mine' as const, label: 'My work' }] : []),
    ...(hasTeam ? [{ key: 'team' as const, label: `My team (${team.data!.people.length})` }] : []),
    ...(leader ? [{ key: 'summary' as const, label: 'Monday summary' }] : []),
  ];
  const [tab, setTab] = useState<'mine' | 'team' | 'summary' | null>(null);
  const cur = tab ?? tabs[0]?.key ?? 'mine';
  return (
    <>
      {tabs.length > 1 && (
        <div className="seg" style={{ marginBottom: 10, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button key={t.key} aria-pressed={cur === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {cur === 'mine' && own && <MyWorkTab />}
      {cur === 'team' && team.data && <TeamTab data={team.data} />}
      {cur === 'summary' && leader && <SummaryTab />}
      {!own && !leader && !hasTeam && team.data && <div className="empty">No work screen for this sign-in.</div>}
    </>
  );
}

// ---------- My work ----------

function MyWorkTab() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.myWork(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your work" />;
  const overdue = data.open.filter((t) => t.state === 'overdue').length;
  return (
    <>
      <div className="kpis">
        <Kpi label="Open tasks" value={data.open.length} />
        <Kpi label="Overdue" value={overdue} tone={overdue ? 'crit' : 'ok'} />
        <Kpi label="Waiting for review" value={data.waitingReview.length} />
        <Kpi
          label="On time, last 4 weeks"
          value={data.measures.onTimePct === null ? 'UNKNOWN' : `${data.measures.onTimePct}%`}
          note={`Standard ${data.measures.standardPct}%`}
          tone={data.measures.atStandard === null ? 'neutral' : data.measures.atStandard ? 'ok' : 'warn'}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{data.playbook.title}</h3>
            <div className="muted small">
              Your manager: {data.manager ? `${data.manager.name}, ${data.manager.title}` : 'none'}
              {data.managerAssumed ? ' (assumed: HR to confirm the reporting line)' : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {data.playbook.items.length > 0 && (
              <Chip tone={data.signoff ? 'ok' : 'warn'}>{data.signoff ? `Playbook signed off by ${data.signoff.by}` : 'Playbook not signed off yet'}</Chip>
            )}
            <Chip tone="info" title="Tasks are kept in both Prima and Microsoft Planner; a newer change in Planner wins.">
              Also in Microsoft Planner{data.planner.mode === 'mock' ? ' (test connection)' : ''}
            </Chip>
          </div>
        </div>
        <CheckInForm data={data} />
      </section>
      <CooNoticesPanel notices={data.cooNotices} />
      <section className="panel">
        <h3>To do</h3>
        <div className="list">
          {data.open.length === 0 && <div className="empty">Nothing open.</div>}
          {data.open.map((t) => (
            <MyTaskRow key={t.id} t={t} />
          ))}
        </div>
        <OwnTaskForm userId={me.user.id} />
      </section>
      <HelpPanel data={data} />
      {data.waitingReview.length > 0 && (
        <section className="panel">
          <h3>Waiting for your manager’s review</h3>
          <div className="list">
            {data.waitingReview.map((t) => (
              <div key={t.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div className="muted small">
                  Finished {dateTimeLabel(t.evidence!.at)}: {t.evidence!.note}
                  {t.evidence!.ref ? ` (${t.evidence!.ref})` : ''} · {t.onTime ? 'on time' : 'late'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <Results m={data.measures} />
      <section className="panel">
        <h3>Working from home</h3>
        <p className="muted small">Working from home opens after the 3-month probation, with the playbook signed off and results at standard.</p>
        <Readiness r={data.readiness} />
      </section>
      <Playbook items={data.playbook.items} />
      {(me.user.itRole === 'manager' || me.user.itRole === 'lead') && <PlannerSync />}
    </>
  );
}

function CheckInForm({ data }: { data: MyWork }) {
  const suggestions = data.open.slice(0, 3).map((t) => t.title);
  const [where, setWhere] = useState<'office' | 'home' | 'branch' | 'field'>(data.homeToday ? 'home' : 'office');
  const [hours, setHours] = useState('08:30-17:30');
  const [p, setP] = useState<string[]>([suggestions[0] ?? '', suggestions[1] ?? '', suggestions[2] ?? '']);
  const [support, setSupport] = useState('');
  const act = useAction();
  const c = data.checkIn;
  if (c)
    return (
      <div className="notice small" data-tone="ok">
        Checked in {hhmm(c.at)} ({c.where}, {c.hours}). Today: {c.priorities.join('; ')}.{c.support ? ` Support asked: ${c.support}` : ''}
      </div>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <h4 style={{ margin: 0 }}>Morning check-in (by {data.checkInBy})</h4>
      <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {(['office', 'home', 'branch', 'field'] as const).map((w) => (
          <button key={w} aria-pressed={where === w} onClick={() => setWhere(w)}>
            {w === 'office' ? 'Office' : w === 'home' ? 'Home' : w === 'branch' ? 'Branch' : 'Field'}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label">Hours today</span>
        <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours today" />
      </label>
      {p.map((v, i) => (
        <input
          key={i}
          className="input"
          placeholder={`Priority ${i + 1}`}
          aria-label={`Priority ${i + 1}`}
          value={v}
          onChange={(e) => setP((x) => x.map((y, k) => (k === i ? e.target.value : y)))}
        />
      ))}
      <input
        className="input"
        placeholder="Support you need today (optional)"
        aria-label="Support needed"
        value={support}
        onChange={(e) => setSupport(e.target.value)}
      />
      {data.homeToday && <div className="muted small">Today is a home day: your priorities become your day plan once you are signed in.</div>}
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={act.busy || !p.some((x) => x.trim())}
        onClick={() => act.run(() => api.workCheckIn({ where, hours, priorities: p.filter((x) => x.trim()), support }), 'Checked in.')}
      >
        Send check-in
      </button>
    </div>
  );
}

function MyTaskRow({ t }: { t: Task }) {
  const [mode, setMode] = useState<null | 'done' | 'time' | 'help'>(null);
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [when, setWhen] = useState(localIn(2));
  const act = useAction();
  const st = STATE[t.state];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 600, minWidth: 0 }}>{t.title}</div>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      <div className="muted small">
        Due {due(t)} · {SOURCE[t.source]}
        {t.assignedBy ? ` (${t.assignedBy})` : ''}
        {t.priority === 'high' ? ' · High priority' : ''}
        {t.late ? ` · more time given: ${t.late.reason}` : ''}
      </div>
      <div className="small">
        <strong>Done means:</strong> {t.doneMeans}
      </div>
      {t.review?.verdict === 'returned' && (
        <div className="notice small" data-tone="warn">
          {t.review.by}: {t.review.note}
        </div>
      )}
      {mode === null && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" onClick={() => setMode('done')}>
            Finish with proof
          </button>
          {!t.late && t.state !== 'overdue' && (
            <button className="btn btn-sm" onClick={() => setMode('time')}>
              Ask for more time
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMode('help')}>
            Stuck? Ask for help
          </button>
        </div>
      )}
      {mode === 'done' && (
        <>
          <input
            className="input"
            placeholder="What came out of it, so your manager can check it"
            aria-label="Proof"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            className="input"
            placeholder="Record number or file name (optional)"
            aria-label="Reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </>
      )}
      {mode === 'time' && (
        <>
          <input className="input" placeholder="Why you need more time" aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
          <input className="input" type="datetime-local" aria-label="New due time" value={when} onChange={(e) => setWhen(e.target.value)} />
        </>
      )}
      {mode === 'help' && (
        <textarea
          className="textarea"
          rows={2}
          placeholder="What you are stuck on"
          aria-label="Help needed"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <ErrorNotice error={act.error} />
      {mode !== null && (
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={async () => {
              const r = await act.run(
                () =>
                  mode === 'done'
                    ? api.workTaskDone(t.id, { note, ref })
                    : mode === 'time'
                      ? api.workTaskLate(t.id, { reason: note, newDueAt: fromLocal(when) })
                      : api.helpAsk({ text: note, taskId: t.id }),
                mode === 'done' ? 'Sent for review.' : mode === 'time' ? 'More time recorded.' : 'Your manager has been asked.',
              );
              if (r) {
                setMode(null);
                setNote('');
              }
            }}
          >
            Send
          </button>
          <button className="btn btn-sm" onClick={() => setMode(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function OwnTaskForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(localIn(1));
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        Add my own task
      </button>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <input className="input" placeholder="Task" aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" type="datetime-local" aria-label="Due" value={when} onChange={(e) => setWhen(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => api.workTaskAdd({ userId, title, doneMeans: '', dueAt: fromLocal(when), priority: 'normal' }), 'Task added.');
            if (r) {
              setTitle('');
              setOpen(false);
            }
          }}
        >
          Add
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function HelpPanel({ data }: { data: MyWork }) {
  const [text, setText] = useState('');
  const act = useAction();
  return (
    <section className="panel">
      <h3>Stuck, need help</h3>
      <p className="muted small">Goes to {data.manager?.name ?? 'your manager'}. Not answered in 30 minutes, it shows to their manager too.</p>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" placeholder="What you are stuck on" aria-label="Ask for help" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="btn btn-sm"
          disabled={act.busy || text.trim().length < 10}
          onClick={async () => {
            const r = await act.run(() => api.helpAsk({ text, taskId: null }), 'Your manager has been asked.');
            if (r) setText('');
          }}
        >
          Ask
        </button>
      </div>
      <ErrorNotice error={act.error} />
      {data.help.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {data.help.map((h) => (
            <div key={h.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div className="small">
                {dateTimeLabel(h.at)}: {h.text}
              </div>
              {h.answer ? (
                <div className="small">
                  <Chip tone="ok">Answered</Chip> {h.answer.by}: {h.answer.text}
                </div>
              ) : (
                <Chip tone={h.escalated ? 'warn' : 'info'}>{h.escalated ? `Waiting; now also with ${h.escalatedTo}` : `Waiting for ${h.managerName}`}</Chip>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Results({ m }: { m: MyWork['measures'] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Results, last 4 weeks</h3>
        <Chip tone={m.atStandard === null ? 'neutral' : m.atStandard ? 'ok' : 'warn'}>
          {m.atStandard === null ? 'UNKNOWN: no tasks due yet' : m.atStandard ? 'At standard' : 'Below standard'}
        </Chip>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Tasks due</th>
              <th>On time</th>
              <th>Returned</th>
              {m.measures.map((x) => (
                <th key={x.id}>
                  {x.label} (standard {x.perWeek}/week)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.weeks.map((w) => (
              <tr key={w.week}>
                <td>{dateLabel(w.week)}</td>
                <td>{w.due}</td>
                <td>{w.onTimePct === null ? 'UNKNOWN' : `${w.onTimePct}%`}</td>
                <td>{w.returned}</td>
                {w.measures.map((x) => (
                  <td key={x.id}>{x.count}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Counted from Prima’s own records: tasks finished by their due time, and the work recorded for each measure. The standard is {m.standardPct}% on time and
        each measure at its weekly standard (proposed, for approval). This week is still running.
      </p>
    </section>
  );
}

function Playbook({ items }: { items: MyWork['playbook']['items'] }) {
  if (items.length === 0) return <div className="notice small">No playbook for this role yet: your manager writes it with HR.</div>;
  return (
    <section className="panel">
      <h3>My playbook</h3>
      <div className="list">
        {items.map((i) => (
          <div key={i.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div style={{ fontWeight: 600 }}>{i.text}</div>
            <div className="muted small">
              {EVERY[i.every]}
              {i.every === 'daily' ? `, by ${i.due}` : i.every === 'weekly' ? `, by ${WEEKDAY[Number(i.due)]} 17:00` : `, by the ${i.due}th`}
            </div>
            <div className="small">Done means: {i.doneMeans}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlannerSync() {
  const act = useAction();
  return (
    <section className="panel">
      <h3>Microsoft Planner</h3>
      <p className="muted small">
        Tasks are kept in both Prima and Planner, Planner preferred. New and changed tasks wait here until they are sent; at go-live this runs on a timer once
        Entra sign-in is approved. Until then the connection is a test one.
      </p>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-sm"
        disabled={act.busy}
        onClick={() =>
          act.run(
            () => api.plannerSync() as Promise<{ sent: number; failed: number }>,
            (r) => `${r.sent} task(s) sent to Planner${r.failed ? `, ${r.failed} failed` : ''}.`,
          )
        }
      >
        Send waiting tasks to Planner
      </button>
    </section>
  );
}

// ---------- My team ----------

type Row = TeamWork['people'][number];

function TeamTab({ data }: { data: TeamWork }) {
  const [open, setOpen] = useState<Row | null>(null);
  const sum = (f: (p: Row) => number) => data.people.reduce((n, p) => n + f(p), 0);
  return (
    <>
      <div className="kpis">
        <Kpi label="People" value={data.people.length} />
        <Kpi label="Overdue tasks" value={sum((p) => p.overdue)} tone={sum((p) => p.overdue) ? 'crit' : 'ok'} />
        <Kpi label="To review" value={sum((p) => p.waitingReview)} tone={sum((p) => p.waitingReview) ? 'info' : 'ok'} />
        <Kpi label="Help waiting" value={data.help.length} tone={data.help.length ? 'warn' : 'ok'} />
        <Kpi label="One-to-one due" value={data.people.filter((p) => p.oneOnOneDue).length} />
        <Kpi label="Talk to" value={data.people.filter((p) => p.talk.length).length} tone={data.people.some((p) => p.talk.length) ? 'warn' : 'ok'} />
      </div>
      {data.help.length > 0 && (
        <section className="panel">
          <h3>Help waiting</h3>
          <div className="list">
            {data.help.map((h) => (
              <HelpAnswerRow key={h.id} h={h} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <h3>Your team today</h3>
        <p className="muted small">
          Exceptions first. Check-in due by {data.rules.checkInBy}; a one-to-one every {data.rules.oneOnOneDays} days; due soon means within{' '}
          {data.rules.dueSoonDays} days. “Talk to” is a prompt for you, never a finding.
        </p>
        <div className="list">
          {data.people.map((p) => (
            <button key={p.userId} className="list-item list-button" style={{ alignItems: 'flex-start' }} onClick={() => setOpen(p)}>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="muted small">
                  {p.title}
                  {p.where === 'home' ? ' · working from home' : ''}
                  {p.signedIn ? ` · signed in ${hhmm(p.signedIn.in)}` : ''}
                </div>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <Chip tone={p.checkInState === 'done' ? 'ok' : p.checkInState === 'late' ? 'warn' : p.checkInState === 'missing' ? 'crit' : 'neutral'}>
                    Check-in: {p.checkInState === 'done' ? 'sent' : p.checkInState === 'late' ? 'late' : p.checkInState === 'missing' ? 'missing' : 'not yet'}
                  </Chip>
                  {p.overdue > 0 && <Chip tone="crit">{p.overdue} overdue</Chip>}
                  {p.dueSoon > 0 && <Chip tone="info">{p.dueSoon} due soon</Chip>}
                  {p.returned > 0 && <Chip tone="warn">{p.returned} returned</Chip>}
                  {p.waitingReview > 0 && <Chip tone="neutral">{p.waitingReview} to review</Chip>}
                  {p.openHelp > 0 && <Chip tone="warn">Asked for help</Chip>}
                  {p.oneOnOneDue && <Chip tone="neutral">One-to-one due</Chip>}
                  <Chip tone={p.atStandard === null ? 'neutral' : p.atStandard ? 'ok' : 'warn'}>
                    {p.onTimePct === null ? 'Results UNKNOWN' : `${p.onTimePct}% on time`}
                  </Chip>
                </div>
                {p.talk.length > 0 && <Chip tone="warn">Talk to them: {p.talk.join('; ')}</Chip>}
              </div>
            </button>
          ))}
        </div>
      </section>
      {open && <PersonDrawer userId={open.userId} name={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}

function HelpAnswerRow({ h }: { h: TeamWork['help'][number] }) {
  const [text, setText] = useState('');
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>
        {h.userName} · {dateTimeLabel(h.at)}
      </div>
      <div className="small">{h.text}</div>
      {h.escalated && <Chip tone="warn">Not answered in 30 minutes{h.managerName ? ` by ${h.managerName}` : ''}</Chip>}
      <div className="row" style={{ gap: 6 }}>
        <input className="input" placeholder="Answer or next step" aria-label="Answer" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || text.trim().length < 5}
          onClick={() => act.run(() => api.helpAnswer(h.id, text), 'Answered.')}
        >
          Answer
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function PersonDrawer({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api.personWork(userId), [userId]);
  return (
    <Drawer title={name} sub={data?.title} onClose={onClose}>
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="their work" />}
      {data && <PersonBody p={data} />}
    </Drawer>
  );
}

function PersonBody({ p }: { p: PersonWork }) {
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Readiness r={p.readiness} />
      {!p.signedOff && p.playbookItems.length > 0 && (
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={act.busy}
          onClick={() => act.run(() => api.playbookSignOff(p.userId), 'Playbook signed off.')}
        >
          Sign off: they know the {p.playbook} playbook
        </button>
      )}
      <ErrorNotice error={act.error} />
      <div>
        <h4 style={{ margin: '0 0 4px' }}>Tasks</h4>
        <div className="list">
          {p.tasks.length === 0 && <div className="empty">Nothing open.</div>}
          {p.cooCheck === 'reason' && <div className="muted small">You are checking in place of their line manager: give the reason (a short one is fine). Their line manager, and whoever gave the task, are told.</div>}
          {p.cooCheck === 'own' && <div className="muted small">Every approval has a reason: a short one is fine.</div>}
          {p.cooCheck === 'not_monitored' && <div className="muted small">The COO checks work only in the departments he directly monitors. Their line manager checks this.</div>}
          {p.tasks.map((t) => (
            <ReviewTaskRow key={t.id} t={t} cooCheck={p.cooCheck} />
          ))}
        </div>
      </div>
      <AssignForm userId={p.userId} />
      <OneOnOneForm userId={p.userId} last={p.oneOnOnes[0] ?? null} />
      <Results m={p.measures} />
    </div>
  );
}

function ReviewTaskRow({ t, cooCheck }: { t: Task; cooCheck: PersonWork['cooCheck'] }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const st = STATE[t.state];
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{t.title}</div>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      <div className="muted small">
        Due {due(t)} · {SOURCE[t.source]} · Done means: {t.doneMeans}
      </div>
      {t.evidence && (
        <div className="small">
          Proof: {t.evidence.note}
          {t.evidence.ref ? ` (${t.evidence.ref})` : ''} · {t.onTime ? 'on time' : 'late'}
        </div>
      )}
      {t.state === 'waiting_review' && cooCheck !== 'not_monitored' && (
        <>
          <input
            className="input"
            placeholder={cooCheck === 'reason' || cooCheck === 'own' ? 'Reason (needed to accept or return it)' : 'Note (needed to return it)'}
            aria-label="Review note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || ((cooCheck === 'reason' || cooCheck === 'own') && !note.trim())}
              onClick={() => act.run(() => api.workTaskReview(t.id, true, note), 'Accepted.')}
            >
              Accept
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || note.trim().length < 10}
              onClick={() => act.run(() => api.workTaskReview(t.id, false, note), 'Returned to fix.')}
            >
              Return to fix
            </button>
          </div>
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AssignForm({ userId }: { userId: string }) {
  const [title, setTitle] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [when, setWhen] = useState(localIn(2));
  const [high, setHigh] = useState(false);
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h4 style={{ margin: 0 }}>Give a task</h4>
      <input className="input" placeholder="Task" aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="textarea"
        rows={2}
        placeholder="What done looks like: the output you will check"
        aria-label="Done means"
        value={doneMeans}
        onChange={(e) => setDoneMeans(e.target.value)}
      />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" type="datetime-local" aria-label="Due" value={when} onChange={(e) => setWhen(e.target.value)} style={{ maxWidth: 220 }} />
        <label className="row small" style={{ gap: 4 }}>
          <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} />
          High priority
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-sm btn-primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={act.busy}
        onClick={async () => {
          const r = await act.run(
            () => api.workTaskAdd({ userId, title, doneMeans, dueAt: fromLocal(when), priority: high ? 'high' : 'normal' }),
            'Task given.',
          );
          if (r) {
            setTitle('');
            setDoneMeans('');
          }
        }}
      >
        Give task
      </button>
    </div>
  );
}

function OneOnOneForm({ userId, last }: { userId: string; last: PersonWork['oneOnOnes'][number] | null }) {
  const [notes, setNotes] = useState('');
  const [agreed, setAgreed] = useState('');
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h4 style={{ margin: 0 }}>One-to-one</h4>
      <div className="muted small">{last ? `Last on ${dateLabel(last.date)} with ${last.managerName}: ${last.notes}` : 'No one-to-one recorded yet.'}</div>
      <textarea className="textarea" rows={2} placeholder="What you talked about" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <textarea
        className="textarea"
        rows={2}
        placeholder="What was agreed, one per line"
        aria-label="Agreed"
        value={agreed}
        onChange={(e) => setAgreed(e.target.value)}
      />
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={act.busy}
        onClick={() => act.run(() => api.oneOnOneRecord({ userId, notes, agreed: agreed.split('\n') }), 'One-to-one recorded.')}
      >
        Record one-to-one
      </button>
    </div>
  );
}

// ---------- Monday summary ----------

function SummaryTab() {
  const { data, error } = useLoad(() => api.workSummary(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the Monday summary" />;
  return <Summary s={data} />;
}

function Summary({ s }: { s: WorkSummary }) {
  return (
    <>
      <p className="muted small">
        Last week (from {dateLabel(s.week)}). At go-live this is sent every Monday at 08:00 (next: {dateTimeLabel(s.sendsAt)}) to the CEO and group leadership.
      </p>
      <div className="kpis">
        <Kpi label="Help answered in 30 min" value={s.help.pct === null ? 'UNKNOWN' : `${s.help.pct}%`} note={`${s.help.answeredIn30} of ${s.help.asked}`} />
        <Kpi label="Talk to" value={s.talk.length} tone={s.talk.length ? 'warn' : 'ok'} />
        <Kpi
          label="Branches red"
          value={s.branches.filter((b) => b.overall === 'red').length}
          tone={s.branches.some((b) => b.overall === 'red') ? 'crit' : 'ok'}
        />
      </div>
      <section className="panel">
        <h3>By department</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>People</th>
                <th>Tasks due</th>
                <th>On time</th>
                <th>Returned</th>
                <th>Overdue now</th>
                <th>One-to-one this week</th>
                <th>Below standard</th>
                <th>No playbook</th>
              </tr>
            </thead>
            <tbody>
              {s.departments.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td>{d.people}</td>
                  <td>{d.due}</td>
                  <td>{d.onTimePct === null ? 'UNKNOWN' : `${d.onTimePct}%`}</td>
                  <td>{d.returned}</td>
                  <td>{d.overdue}</td>
                  <td>{d.oneOnOnePct}%</td>
                  <td>{d.belowStandard}</td>
                  <td>{d.noPlaybook}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Far branches</h3>
        <div className="list">
          {s.branches.map((b) => (
            <div key={b.id} className="list-item">
              <div>
                <div style={{ fontWeight: 600 }}>{b.name}</div>
                <div className="muted small">
                  {b.red} red, {b.unknown} unknown of 8 measures
                </div>
              </div>
              <Chip tone={SCORE[b.overall].tone}>{SCORE[b.overall].label}</Chip>
            </div>
          ))}
        </div>
      </section>
      {s.talk.length > 0 && (
        <section className="panel">
          <h3>Managers asked to talk to</h3>
          <div className="list">
            {s.talk.map((t) => (
              <div key={t.userId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="muted small">
                  {t.title} · {t.reasons.join('; ')}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <PlannerSync />
    </>
  );
}

// ---------- Far branches ----------

type BranchRow = BranchWork['branches'][number];
const KIND_LABEL = { om: 'OM visit', rom: 'Regional OM visit', act: 'ACT unannounced audit', spot: 'Video spot check' } as const;

/**
 * Far branches (Fauzan, 27 Oct 2026): checklists with photo proof, an 8-measure scorecard where UNKNOWN is never green,
 * OM twice a month, Regional OM monthly, ACT unannounced once a half year, and up to 2 random video spot checks a month.
 */
export function BranchWorkView() {
  const { data, error } = useLoad(() => api.branchWork(), []);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="branches" />;
  const b = data.branches.find((x) => x.id === open) ?? null;
  return (
    <>
      <div className="kpis">
        <Kpi label="Branches" value={data.branches.length} />
        <Kpi
          label="Red"
          value={data.branches.filter((x) => x.overall === 'red').length}
          tone={data.branches.some((x) => x.overall === 'red') ? 'crit' : 'ok'}
        />
        <Kpi
          label="Daily checklist sent today"
          value={`${data.branches.filter((x) => x.due.find((d) => d.kind === 'daily')?.done).length} of ${data.branches.length}`}
        />
      </div>
      <div className="list">
        {data.branches.length === 0 && <div className="empty">No branches for this sign-in.</div>}
        {data.branches.map((x) => (
          <button key={x.id} className="list-item list-button" style={{ alignItems: 'flex-start' }} onClick={() => setOpen(x.id)}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600 }}>{x.name}</div>
              <div className="muted small">
                {x.company} · {x.manager ? x.manager.name : 'no branch manager sign-in'}
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {x.score.map((s) => (
                  <Chip key={s.key} tone={SCORE[s.state].tone} title={`${s.label}: ${s.value}`}>
                    {s.key === 'daily'
                      ? 'Daily'
                      : s.key === 'weekly'
                        ? 'Weekly'
                        : s.key === 'monthly'
                          ? 'Monthly'
                          : s.key === 'om'
                            ? 'OM'
                            : s.key === 'rom'
                              ? 'ROM'
                              : s.key === 'act'
                                ? 'ACT'
                                : s.key === 'spot'
                                  ? 'Spot'
                                  : 'Tasks'}
                  </Chip>
                ))}
              </div>
            </div>
            <Chip tone={SCORE[x.overall].tone}>{SCORE[x.overall].label}</Chip>
          </button>
        ))}
      </div>
      <p className="muted small">A measure with no data shows UNKNOWN, never green. Visit and spot-check limits are proposals for approval.</p>
      {b && <BranchDrawer b={b} checklists={data.checklists} onClose={() => setOpen(null)} />}
    </>
  );
}

function BranchDrawer({ b, checklists, onClose }: { b: BranchRow; checklists: BranchWork['checklists']; onClose: () => void }) {
  return (
    <Drawer title={b.name} sub={`${b.company} · ${b.state}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="table-wrap">
          <table>
            <tbody>
              {b.score.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td>{s.value}</td>
                  <td>
                    <Chip tone={SCORE[s.state].tone}>{SCORE[s.state].label}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4 style={{ margin: 0 }}>Checklists</h4>
        {b.due.map((d) => (
          <div key={d.kind} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                {EVERY[d.kind]} ({d.period}, due {d.due})
              </strong>
              <Chip tone={d.done ? 'ok' : 'neutral'}>{d.done ? `Sent ${dateTimeLabel(d.done.at)}` : 'Not sent'}</Chip>
            </div>
            {d.done && (
              <div className="small">
                {d.done.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.label}${i.note ? ` (${i.note})` : ''}`).join(' · ')}
                {d.done.proof ? ` · photo ${d.done.proof.sha256.slice(0, 10)}…` : ''}
              </div>
            )}
            {!d.done && b.canCheck && <ChecklistForm b={b} kind={d.kind} items={checklists[d.kind].items} />}
          </div>
        ))}
        <h4 style={{ margin: 0 }}>Visits and spot checks</h4>
        {b.canVisit.map((k) => (
          <VisitForm key={k} b={b} kind={k} />
        ))}
        <div className="list">
          {b.visits.length === 0 && <div className="empty">No visits recorded.</div>}
          {b.visits.map((v) => (
            <div key={v.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {KIND_LABEL[v.kind]} · {dateLabel(v.at.slice(0, 10))}
                </strong>
                <Chip tone={v.result === 'ok' ? 'ok' : 'crit'}>{v.result === 'ok' ? 'In order' : 'Issues'}</Chip>
              </div>
              <div className="muted small">
                {v.by}
                {v.announced ? '' : ' · unannounced'}
              </div>
              <div className="small">{v.findings}</div>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

type Proof = { image: string; capturedAt?: string; lat?: number | null; lng?: number | null };

function ProofCamera({ b, refText, proof, setProof }: { b: BranchRow; refText: string; proof: Proof | null; setProof: (p: Proof | null) => void }) {
  const [cam, setCam] = useState(false);
  if (proof)
    return (
      <div className="row small" style={{ gap: 6 }}>
        <Chip tone="ok">Photo ready</Chip>
        <button className="btn btn-sm btn-ghost" onClick={() => setProof(null)}>
          Retake
        </button>
      </div>
    );
  if (!cam)
    return (
      <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCam(true)}>
        Take the photo
      </button>
    );
  const at = b.place ?? { lat: 3.139, lng: 101.6869 };
  return (
    <EvidenceCamera
      site={{ code: b.name, lat: at.lat, lng: at.lng }}
      refText={refText}
      collect
      onSend={async (p) => setProof({ image: p.image, capturedAt: p.capturedAt, lat: p.lat, lng: p.lng })}
      onDone={() => setCam(false)}
    />
  );
}

function ChecklistForm({ b, kind, items }: { b: BranchRow; kind: 'daily' | 'weekly' | 'monthly'; items: { key: string; label: string }[] }) {
  const [state, setState] = useState<Record<string, { ok: boolean; note: string }>>(Object.fromEntries(items.map((i) => [i.key, { ok: true, note: '' }])));
  const [proof, setProof] = useState<Proof | null>(null);
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((i) => (
        <div key={i.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={state[i.key].ok} onChange={(e) => setState((s) => ({ ...s, [i.key]: { ...s[i.key], ok: e.target.checked } }))} />
            {i.label}
          </label>
          {!state[i.key].ok && (
            <input
              className="input"
              placeholder="What is wrong, and what you did"
              aria-label={`Note for ${i.label}`}
              value={state[i.key].note}
              onChange={(e) => setState((s) => ({ ...s, [i.key]: { ...s[i.key], note: e.target.value } }))}
            />
          )}
        </div>
      ))}
      <ProofCamera b={b} refText={`${EVERY[kind]} checklist`} proof={proof} setProof={setProof} />
      <ErrorNotice error={act.error} />
      <button
        className="btn btn-sm btn-primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={act.busy || !proof}
        onClick={() =>
          act.run(() => api.branchCheckSubmit(b.id, { kind, items: items.map((i) => ({ key: i.key, ...state[i.key] })), proof }), 'Checklist sent.')
        }
      >
        Send {EVERY[kind].toLowerCase()} checklist
      </button>
    </div>
  );
}

function VisitForm({ b, kind }: { b: BranchRow; kind: 'om' | 'rom' | 'act' | 'spot' }) {
  const [open, setOpen] = useState(false);
  const [findings, setFindings] = useState('');
  const [issues, setIssues] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Record {KIND_LABEL[kind].toLowerCase()}
        {kind === 'spot' ? ` (${b.spotsThisMonth} of 2 this month)` : ''}
      </button>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        className="textarea"
        rows={3}
        placeholder="What you found"
        aria-label="Findings"
        value={findings}
        onChange={(e) => setFindings(e.target.value)}
      />
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={issues} onChange={(e) => setIssues(e.target.checked)} />
        Issues found
      </label>
      {kind !== 'spot' && <ProofCamera b={b} refText={KIND_LABEL[kind]} proof={proof} setProof={setProof} />}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || (kind !== 'spot' && !proof)}
          onClick={async () => {
            const r = await act.run(() => api.branchVisitRecord(b.id, { kind, result: issues ? 'issues' : 'ok', findings, proof }), 'Recorded.');
            if (r) setOpen(false);
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
