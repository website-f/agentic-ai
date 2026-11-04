import { useState } from 'react';
import type { RemoteStep } from '@prima/core';
import { api, type MyRemote, type RemoteBoard } from '../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { gps } from './Camera';

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STEP: Record<RemoteStep, { label: string; tone: Tone }> = {
  done: { label: 'Done', tone: 'ok' },
  late: { label: 'Late', tone: 'warn' },
  missed: { label: 'Missed', tone: 'crit' },
  open: { label: 'Due now', tone: 'info' },
  upcoming: { label: 'Later', tone: 'neutral' },
  not_needed: { label: 'Not needed', tone: 'neutral' },
};
const days = (d: number[]) => d.map((x) => WEEKDAY[x]).join(', ');

type DayView = NonNullable<MyRemote['today']>;

/** One line per step of a home day: plan, check-ins, report, review. */
function DayChips({ v }: { v: DayView }) {
  const s = v.status;
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <Chip tone={STEP[s.plan].tone}>Plan: {STEP[s.plan].label}</Chip>
      {s.checkIns.map((c) => (
        <Chip key={c.due} tone={STEP[c.state].tone}>
          {c.due}: {STEP[c.state].label}
        </Chip>
      ))}
      <Chip tone={STEP[s.report].tone}>Report: {STEP[s.report].label}</Chip>
      {v.day?.review && <Chip tone={v.day.review.verdict === 'accepted' ? 'ok' : 'warn'}>{v.day.review.verdict === 'accepted' ? 'Accepted' : 'Queried'}</Chip>}
      {v.day?.start && !v.day.start.atPlace && <Chip tone="warn">Started {(v.day.start.distanceM / 1000).toFixed(1)} km from the approved place</Chip>}
    </div>
  );
}

/**
 * The staff member's own working from home, on the Clock screen: apply, then on a home day post the plan, check in at
 * the fixed times and report at the end of the day (Fauzan, 27 Oct 2026). They see everything their manager sees.
 */
export function MyRemoteSection() {
  const { data, error } = useLoad(() => api.myRemote(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="working from home" />;
  if (!data.eligible) return null;
  const cur = data.current;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Working from home</h3>
          <div className="muted small">
            On a home day you post a plan, check in at {data.rules.checkIns.times.join(' and ')} and report what you finished. Your work is checked, not your
            screen.
          </div>
        </div>
        {cur?.status === 'approved' && (
          <Chip tone={data.homeToday ? 'info' : 'neutral'}>{data.homeToday ? 'Home day today' : `Home on ${days(cur.days)}`}</Chip>
        )}
        {cur?.status === 'applied' && <Chip tone="warn">Waiting for an answer</Chip>}
      </div>
      {!cur && data.readiness && <Readiness r={data.readiness} />}
      {!cur && <ApplyForm data={data} />}
      {cur?.status === 'applied' && (
        <p className="small">
          You applied on {dateLabel(cur.appliedAt.slice(0, 10))} for {days(cur.days)} from {dateLabel(cur.from)}. The written answer is due by{' '}
          {dateLabel(cur.answerBy)}.
        </p>
      )}
      {cur?.status === 'approved' && (
        <p className="muted small">
          Approved by {cur.decidedBy}: {days(cur.days)}, {dateLabel(cur.from)} to {cur.to ? dateLabel(cur.to) : 'until ended'}. Place: {cur.place.label}.
          {cur.decisionNote ? ` “${cur.decisionNote}”` : ''}
        </p>
      )}
      {data.today && <TodayAtHome v={data.today} suggested={data.suggested} />}
      {data.recent.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 4px' }}>Recent home days</h4>
          <div className="list">
            {data.recent.map((v) => (
              <div key={v.day!.id} className="list-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 600 }}>
                  {dateLabel(v.day!.date)}
                  {v.clock ? ` · ${hhmm(v.clock.in)}–${hhmm(v.clock.out)}` : ' · not signed in'}
                  {v.status.tasks.planned ? ` · ${v.status.tasks.done} of ${v.status.tasks.planned} tasks done` : ''}
                </div>
                <DayChips v={v} />
                {v.day?.review?.verdict === 'queried' && (
                  <div className="notice small" data-tone="warn">
                    {v.day.review.by}: {v.day.review.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {data.history.length > 0 && (
        <p className="muted small">
          Earlier:{' '}
          {data.history
            .map(
              (a) =>
                `${a.status === 'refused' ? 'refused' : 'ended'} ${dateLabel((a.endedAt ?? a.decidedAt ?? a.appliedAt).slice(0, 10))}${a.decisionNote || a.endNote ? ` (${a.endNote || a.decisionNote})` : ''}`,
            )
            .join('; ')}
        </p>
      )}
    </section>
  );
}

function ApplyForm({ data }: { data: MyRemote }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [from, setFrom] = useState(new Date(Date.now() + 8 * 3_600_000 + 7 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('Home');
  const [place, setPlace] = useState<{ lat: number; lng: number } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Apply to work from home
      </button>
    );
  const pickPlace = async () => {
    if (api.mode === 'demo') {
      const b = data.base ?? { lat: 3.139, lng: 101.6869 };
      return setPlace({ lat: b.lat + 0.08, lng: b.lng });
    }
    const f = await gps();
    if (f.lat === null || f.lng === null) throw new Error('This device gave no location. Allow location and try again at the place you will work from.');
    setPlace({ lat: f.lat, lng: f.lng });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="small">
        This is a written application for a flexible working arrangement (Employment Act 1955 s.60P). Your manager must answer in writing within{' '}
        {data.rules.answerDays} days and give the reason if they refuse.
      </p>
      <div className="field">
        <span className="label">Days at home</span>
        <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5].map((d) => (
            <button key={d} aria-pressed={picked.includes(d)} onClick={() => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))}>
              {WEEKDAY[d]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="label">From</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First day" />
        </label>
        <label className="field">
          <span className="label">Until (leave empty to run until ended)</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Last day" />
        </label>
      </div>
      <label className="field">
        <span className="label">Reason</span>
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason"
          placeholder="e.g. long commute, caring for a parent"
        />
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="label">Place name</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Place name" />
        </label>
        <div className="field">
          <span className="label">Location of the place</span>
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => act.run(pickPlace)}>
            {place ? 'Location set ✓' : api.mode === 'demo' ? 'Test only: use a mock home location' : 'Use this device’s location here'}
          </button>
        </div>
      </div>
      <div className="notice small" data-tone="info">
        <strong>What is recorded on a home day</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {data.notice.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />I have read this notice and agree.
      </label>
      <ErrorNotice error={act.error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={act.busy || !picked.length || !place || !accepted || reason.trim().length < 5}
          onClick={() =>
            act.run(
              () =>
                api.remoteApply({ days: picked, from, to: to || null, reason, place: { label, lat: place!.lat, lng: place!.lng }, noticeAccepted: accepted }),
              'Application sent.',
            )
          }
        >
          Send application
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TodayAtHome({ v, suggested }: { v: DayView; suggested: string[] }) {
  const [newTasks, setNewTasks] = useState('');
  const [note, setNote] = useState('');
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const act = useAction();
  const d = v.day;
  const s = v.status;
  const due = s.checkIns.find((c) => c.state === 'open') ?? s.checkIns.find((c) => c.state === 'missed');
  if (!v.clock) return <p className="notice small">Today is a home day. Sign in to start it: your plan, check-ins and report open then.</p>;
  const reported = !!d?.report;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <DayChips v={v} />
      <div className="muted small">
        Signed in {hhmm(v.clock.in)}. Work recorded in Prima today: {v.work.actions} action{v.work.actions === 1 ? '' : 's'}
        {v.work.lastAt ? `, last at ${hhmm(v.work.lastAt)}` : ''}.
        {d?.start
          ? d.start.atPlace
            ? ' Started at the approved place.'
            : ` Started ${(d.start.distanceM / 1000).toFixed(1)} km from the approved place.`
          : ' Start place not checked yet.'}
      </div>
      <div>
        <h4 style={{ margin: '4px 0' }}>Today’s plan {s.planDueAt && !d?.plan ? `(due by ${hhmm(s.planDueAt)})` : ''}</h4>
        <div className="list">
          {(d?.plan?.tasks ?? []).map((t) => (
            <div key={t.id} className="list-item" style={{ alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.text}</div>
                {t.output && <div className="muted small">{t.output}</div>}
                {t.status === 'planned' && !reported && (
                  <input
                    className="input"
                    style={{ marginTop: 4 }}
                    placeholder="What came out of it (file, record number, one sentence)"
                    aria-label={`Output for ${t.text}`}
                    value={outputs[t.id] ?? ''}
                    onChange={(e) => setOutputs((o) => ({ ...o, [t.id]: e.target.value }))}
                  />
                )}
              </div>
              {t.status === 'planned' && !reported ? (
                <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.remoteTask(t.id, true, outputs[t.id] ?? ''), 'Task done.')}>
                  Done
                </button>
              ) : (
                <Chip tone={t.status === 'done' ? 'ok' : 'neutral'}>{t.status === 'done' ? 'Done' : t.status === 'carried' ? 'Carried over' : 'Planned'}</Chip>
              )}
            </div>
          ))}
        </div>
        {!reported && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <textarea
              className="textarea"
              rows={3}
              placeholder={d?.plan ? 'Add tasks, one per line' : 'Your tasks for today, one per line'}
              aria-label="Tasks"
              value={newTasks}
              onChange={(e) => setNewTasks(e.target.value)}
            />
            {suggested.length > 0 && !newTasks && (
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNewTasks(suggested.join('\n'))}>
                Fill from my open tasks ({suggested.length})
              </button>
            )}
            <button
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={act.busy || !newTasks.trim()}
              onClick={async () => {
                const r = await act.run(() => api.remotePlan(newTasks.split('\n')), d?.plan ? 'Tasks added.' : 'Plan posted.');
                if (r) setNewTasks('');
              }}
            >
              {d?.plan ? 'Add to plan' : 'Post plan'}
            </button>
          </div>
        )}
      </div>
      <div>
        <h4 style={{ margin: '4px 0' }}>Check-ins</h4>
        <div className="small muted">{s.checkIns.map((c) => `${c.due}${c.at ? ` answered ${hhmm(c.at)}${c.note ? `: ${c.note}` : ''}` : ''}`).join(' · ')}</div>
        {due && !reported && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input
              className="input"
              placeholder="One line: what you are working on"
              aria-label="Check-in note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || note.trim().length < 3}
              onClick={async () => {
                const r = await act.run(() => api.remoteCheckIn(note), 'Checked in.');
                if (r) setNote('');
              }}
            >
              Check in for {due.due}
              {due.state === 'missed' ? ' (late)' : ''}
            </button>
          </div>
        )}
      </div>
      <div>
        <h4 style={{ margin: '4px 0' }}>End-of-day report</h4>
        {d?.report ? (
          <div className="small">
            <div>
              Sent {hhmm(d.report.at)}: {d.report.summary}
            </div>
            {d.report.blockers && <div className="muted">Blockers: {d.report.blockers}</div>}
            {d.review && (
              <div className="notice" data-tone={d.review.verdict === 'accepted' ? 'ok' : 'warn'} style={{ marginTop: 4 }}>
                {d.review.by} {d.review.verdict === 'accepted' ? 'accepted the day' : `asks: ${d.review.note}`}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              className="textarea"
              rows={3}
              placeholder="What you finished today"
              aria-label="Report"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <input
              className="input"
              placeholder="Anything blocking you (optional)"
              aria-label="Blockers"
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
            />
            <button
              className="btn btn-sm btn-primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={act.busy || summary.trim().length < 10 || !d?.plan}
              onClick={() => act.run(() => api.remoteReport({ summary, blockers }), 'Report sent. Sign out when you finish.')}
            >
              Send report
            </button>
            {!d?.plan && <span className="muted small">Post the plan first; the report is against it.</span>}
          </div>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

type Person = RemoteBoard['people'][number];

/** Working from home for the manager, central HR and group leadership, on the Staff clock screen. */
export function RemoteBoardView() {
  const { data, error } = useLoad(() => api.remoteBoard(), []);
  const [open, setOpen] = useState<Person | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="working from home" />;
  const home = data.people.filter((p) => p.homeToday);
  const signedIn = home.filter((p) => p.today?.clock && !p.today.clock.out);
  const missesToday = home.reduce((n, p) => n + (p.today?.status.misses ?? 0), 0);
  return (
    <>
      <p className="muted small">
        Staff working from home post a plan within {data.rules.planMin} minutes of signing in, check in at {data.rules.checkIns.times.join(' and ')} and report
        at the end of the day. You review the work. {data.rules.pattern.misses} or more misses in their last {data.rules.pattern.days} home days asks you to
        talk to them; nothing is decided automatically.
      </p>
      <div className="kpis">
        <Kpi label="Home today" value={home.length} />
        <Kpi label="Signed in" value={signedIn.length} />
        <Kpi label="Misses today" value={missesToday} tone={missesToday ? 'warn' : 'ok'} />
        <Kpi label="Days to review" value={data.toReview.filter((r) => r.canDecide).length} tone={data.toReview.some((r) => r.canDecide) ? 'info' : 'ok'} />
        <Kpi
          label="Applications to answer"
          value={data.applications.filter((a) => a.canDecide).length}
          tone={data.applications.some((a) => a.canDecide) ? 'warn' : 'ok'}
        />
      </div>
      <section className="panel">
        <h3>Working from home</h3>
        <div className="list">
          {data.people.length === 0 && <div className="empty">Nobody works from home.</div>}
          {data.people.map((p) => (
            <button key={p.arrangement.id} className="list-item list-button" style={{ alignItems: 'flex-start' }} onClick={() => setOpen(p)}>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 600 }}>{p.arrangement.userName}</div>
                <div className="muted small">
                  {p.company} · home {days(p.arrangement.days)}
                </div>
                {p.today && (
                  <div className="muted small">
                    {p.today.clock ? `Signed in ${hhmm(p.today.clock.in)}${p.today.clock.out ? `, out ${hhmm(p.today.clock.out)}` : ''}` : 'Not signed in'}
                    {p.today.status.tasks.planned ? ` · ${p.today.status.tasks.done} of ${p.today.status.tasks.planned} tasks done` : ''}
                    {` · ${p.today.work.actions} actions in Prima`}
                  </div>
                )}
                {p.today?.clock && <DayChips v={p.today} />}
                {p.talk && (
                  <Chip tone="warn">
                    Talk to them: {p.missesRecent} misses in the last {p.recentDays} home days
                  </Chip>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                <Chip tone={p.homeToday ? 'info' : 'neutral'}>{p.homeToday ? 'Home today' : 'In the office today'}</Chip>
              </div>
            </button>
          ))}
        </div>
      </section>
      {data.toReview.length > 0 && (
        <section className="panel">
          <h3>Home days to review</h3>
          <div className="list">
            {data.toReview.map((r) => (
              <ReviewRow key={r.day!.id} r={r} />
            ))}
          </div>
        </section>
      )}
      {data.applications.length > 0 && (
        <section className="panel">
          <h3>Applications</h3>
          <div className="list">
            {data.applications.map((a) => (
              <ApplicationRow key={a.arrangement.id} a={a} />
            ))}
          </div>
        </section>
      )}
      <p className="muted small">
        No screenshots, keystrokes, camera or following the location at home: the location is checked once at the start of a home day and only the distance is
        kept. Staff are told this in writing before they apply.
      </p>
      {open && <PersonDrawer p={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReviewRow({ r }: { r: RemoteBoard['toReview'][number] }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const d = r.day!;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>
        {d.userName} · {dateLabel(d.date)}
      </div>
      <div className="muted small">{r.company}</div>
      <DayChips v={r} />
      <div className="small">
        {(d.plan?.tasks ?? []).map((t) => (
          <div key={t.id}>
            {t.status === 'done' ? '✓' : '→'} {t.text}
            {t.output ? <span className="muted"> · {t.output}</span> : t.status === 'carried' ? <span className="muted"> · carried over</span> : null}
          </div>
        ))}
      </div>
      <div className="small">Report: {d.report!.summary}</div>
      {d.report!.blockers && <div className="small muted">Blockers: {d.report!.blockers}</div>}
      {r.canDecide ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Note (needed to query)" aria-label="Review note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy}
            onClick={() => act.run(() => api.remoteReview(d.id, 'accepted', note), 'Day accepted.')}
          >
            Accept
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 5}
            onClick={() => act.run(() => api.remoteReview(d.id, 'queried', note), 'Query sent.')}
          >
            Query
          </button>
        </div>
      ) : (
        <span className="muted small">Reviewed by their own manager.</span>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

/** Ready to work from home (D5): probation passed, playbook signed off, results at standard. Unknown is not a pass. */
export function Readiness({ r }: { r: { ready: boolean; checks: { key: string; label: string; ok: boolean | null; detail: string }[] } }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <Chip tone={r.ready ? 'ok' : 'warn'}>{r.ready ? 'Ready to work from home' : 'Not ready yet'}</Chip>
      {r.checks.map((c) => (
        <Chip key={c.key} tone={c.ok === true ? 'ok' : c.ok === false ? 'crit' : 'neutral'} title={c.detail}>
          {c.ok === true ? '✓' : c.ok === false ? '✗' : '?'} {c.label}
        </Chip>
      ))}
    </div>
  );
}

function ApplicationRow({ a }: { a: RemoteBoard['applications'][number] }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const x = a.arrangement;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ fontWeight: 600 }}>{x.userName}</div>
      <div className="muted small">
        {a.company} · {days(x.days)} from {dateLabel(x.from)}
        {x.to ? ` to ${dateLabel(x.to)}` : ''} · {x.place.label}
      </div>
      <div className="small">Reason: {x.reason}</div>
      <div className="small">
        <Chip tone={a.daysLeft <= 14 ? 'warn' : 'neutral'}>
          Written answer due {dateLabel(x.answerBy)} ({a.daysLeft} days)
        </Chip>
      </div>
      <Readiness r={a.readiness} />
      {a.canDecide ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder={a.readiness.ready ? 'Written answer (grounds needed to refuse)' : 'Written answer (a reason is needed to approve an exception, or to refuse)'}
            aria-label="Answer"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.remoteDecide(x.id, true, note), 'Approved.')}>
            Approve
          </button>
          <button
            className="btn btn-sm"
            disabled={act.busy || note.trim().length < 10}
            onClick={() => act.run(() => api.remoteDecide(x.id, false, note), 'Refused in writing.')}
          >
            Refuse
          </button>
        </div>
      ) : (
        <span className="muted small">Answered by their own manager.</span>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function PersonDrawer({ p, onClose }: { p: Person; onClose: () => void }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const a = p.arrangement;
  const d = p.today?.day;
  return (
    <Drawer title={a.userName} sub={`${p.company} · home ${days(a.days)}`} onClose={onClose}>
      <p className="small">
        Approved by {a.decidedBy} on {a.decidedAt ? dateLabel(a.decidedAt.slice(0, 10)) : '–'}, {dateLabel(a.from)} to {a.to ? dateLabel(a.to) : 'until ended'}.
        Reason: {a.reason}
      </p>
      <p className="small">
        Last {p.recentDays} home days: {p.reportsOnTime} reported, {p.missesRecent} misses.
      </p>
      {p.today && (
        <section>
          <h3>Today</h3>
          {p.today.clock ? <DayChips v={p.today} /> : <p className="muted small">Not signed in yet.</p>}
          <div className="small" style={{ marginTop: 6 }}>
            {(d?.plan?.tasks ?? []).map((t) => (
              <div key={t.id}>
                {t.status === 'done' ? '✓' : '○'} {t.text}
                {t.output ? <span className="muted"> · {t.output}</span> : null}
              </div>
            ))}
            {!d?.plan && p.today.clock && <div className="muted">No plan yet.</div>}
            {(d?.checkIns ?? []).map((c) => (
              <div key={c.due} className="muted">
                Check-in {c.due} at {hhmm(c.at)}: {c.note}
              </div>
            ))}
            <div className="muted">
              Work recorded in Prima: {p.today.work.actions} actions{p.today.work.lastAt ? `, last at ${hhmm(p.today.work.lastAt)}` : ''}. Work in other systems
              shows in the plan and report.
            </div>
          </div>
        </section>
      )}
      {p.canDecide && (
        <section>
          <h3>End working from home</h3>
          <p className="muted small">Only in writing, with the reason. Talk to the staff member first.</p>
          <input className="input" placeholder="Written reason" aria-label="Reason to end" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-sm"
            style={{ marginTop: 6 }}
            disabled={act.busy || note.trim().length < 10}
            onClick={async () => {
              const r = await act.run(() => api.remoteEnd(a.id, note), 'Working from home ended.');
              if (r) onClose();
            }}
          >
            End the arrangement
          </button>
          <ErrorNotice error={act.error} />
        </section>
      )}
    </Drawer>
  );
}
