import { useState } from 'react';
import { myt } from '@prima/core';
import { api, type Meetings } from '../api';
import { useApp } from '../App';
import { saveFile } from '../save';
import { Chip, notify, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';

type Row = Meetings['rows'][number];
type Deadline = Meetings['deadlines'][number];

const KIND: Record<Deadline['kind'], { label: string; tone: Tone }> = {
  meeting: { label: 'Meeting', tone: 'info' },
  action: { label: 'Action', tone: 'warn' },
  tender: { label: 'Tender', tone: 'neutral' },
  report: { label: 'Report', tone: 'neutral' },
};

const MEETING_KIND = {
  board: 'Board',
  management: 'Management',
  operations: 'Operations',
  department: 'Department',
  client: 'Client',
  toolbox: 'Toolbox talk',
  other: 'Other',
} as const;
const REPEAT = {
  '': 'One time',
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every quarter',
  yearly: 'Every year',
} as const;

/** Calendar file Outlook opens; production syncs with the Outlook calendar through Microsoft 365. */
function icsFor(items: Deadline[]): string {
  const stamp = (t: string) =>
    new Date(t)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prima Secure App//Director Office//EN', 'CALSCALE:GREGORIAN'];
  items.forEach((d, i) => {
    lines.push('BEGIN:VEVENT', `UID:prima-${d.kind}-${d.date}-${i}@prima-secure-app`, `DTSTAMP:${stamp(new Date().toISOString())}`);
    if (d.start && d.end) lines.push(`DTSTART:${stamp(d.start)}`, `DTEND:${stamp(d.end)}`);
    else lines.push(`DTSTART;VALUE=DATE:${d.date.replace(/-/g, '')}`);
    lines.push(
      `SUMMARY:${esc(`${KIND[d.kind].label}: ${d.title}`)}`,
      `DESCRIPTION:${esc(d.detail)}`,
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(d.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function download(items: Deadline[], name: string) {
  const problem = await saveFile(name, new Blob([icsFor(items)], { type: 'text/calendar' }));
  if (problem) notify(problem);
}

/** Meetings across the group, their minutes and summaries, and every deadline for the calendar (Fauzan, 25 Oct 2026). */
export function MeetingsView() {
  const { data, error } = useLoad(() => api.meetings(), []);
  const [tab, setTab] = useState<'calendar' | 'meetings'>('calendar');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="meetings" />
      </div>
    );
  const row = data.rows.find((r) => r.meeting.id === open);
  const toCheck = data.rows.filter((r) => r.canCheck).length;
  const noMinutes = data.rows.filter((r) => r.meeting.status !== 'cancelled' && !r.meeting.minutes && r.meeting.end < new Date().toISOString()).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Meetings and deadlines</h1>
          <p>Every meeting with its minutes and summary, and the dates that matter: meetings, action items, tender closing dates and reports due.</p>
        </div>
        {data.canSchedule && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New meeting
          </button>
        )}
      </div>
      <div className="kpis">
        <Kpi label="Dates in next 60 days" value={data.deadlines.length} />
        <Kpi label="Action items overdue" value={data.overdueActions.length} tone={data.overdueActions.length ? 'crit' : 'ok'} />
        <Kpi label="Held, no minutes yet" value={noMinutes} tone={noMinutes ? 'warn' : 'ok'} />
        <Kpi label="Within 24 hours, pre-brief not done" value={data.prepNotReady} tone={data.prepNotReady ? 'crit' : 'ok'} />
        {data.doa && <Kpi label="Summaries to check" value={toCheck} tone={toCheck ? 'warn' : 'ok'} />}
      </div>
      <div className="tabbar" role="tablist" aria-label="Meetings sections">
        <button role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Calendar
        </button>
        <button role="tab" aria-selected={tab === 'meetings'} onClick={() => setTab('meetings')}>
          Meetings and minutes
        </button>
      </div>
      {tab === 'calendar' && (
        <section className="panel">
          <div className="panel-head">
            <h3>Next 60 days</h3>
            <button className="btn btn-sm" disabled={!data.deadlines.length} onClick={() => download(data.deadlines, 'prima-deadlines.ics')}>
              Add all to Outlook
            </button>
          </div>
          <div className="list">
            {data.deadlines.length === 0 && <div className="empty">Nothing in the next 60 days.</div>}
            {data.deadlines.map((d, i) => (
              <div key={i} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{d.title}</div>
                  <div className="muted small">
                    {dateLabel(d.date)}
                    {d.start ? ` · ${hhmm(d.start)}–${hhmm(d.end)}` : ''} · {d.detail}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <Chip tone={KIND[d.kind].tone}>{KIND[d.kind].label}</Chip>
                  <button className="btn btn-sm" aria-label={`Add ${d.title} to Outlook`} onClick={() => download([d], 'prima-date.ics')}>
                    Outlook
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ padding: '8px 12px' }}>
            Opens as a calendar file in Outlook, with a reminder the day before. Syncing straight into the Outlook calendar needs the Microsoft 365 connection,
            which comes with the live system.
          </p>
        </section>
      )}
      {tab === 'meetings' && (
        <section className="panel">
          <div className="list">
            {data.rows.length === 0 && <div className="empty">No meetings yet.</div>}
            {data.rows.map((r) => (
              <button key={r.meeting.id} className="list-item list-button" onClick={() => setOpen(r.meeting.id)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.meeting.title}</div>
                  <div className="muted small">
                    {dateLabel(r.meeting.start.slice(0, 10))} {hhmm(r.meeting.start)} · {r.companyName} · {MEETING_KIND[r.meeting.kind]}
                  </div>
                </div>
                <MeetingChip r={r} />
              </button>
            ))}
          </div>
        </section>
      )}
      {row && <MeetingDrawer r={row} reader={data.reader} onClose={() => setOpen(null)} />}
      {creating && <NewMeeting doa={data.doa} onClose={() => setCreating(false)} />}
    </div>
  );
}

function MeetingChip({ r }: { r: Row }) {
  const m = r.meeting;
  if (m.status === 'cancelled') return <Chip tone="neutral">Cancelled</Chip>;
  if (m.status === 'scheduled') {
    const done = r.prep.filter((x) => x.done).length;
    if (r.prepState === 'ready') return <Chip tone="ok">Pre-brief ready</Chip>;
    return <Chip tone={r.prepState === 'late' ? 'crit' : 'info'}>{`Pre-brief ${done} of ${r.prep.length}`}</Chip>;
  }
  if (!m.minutes) return <Chip tone="warn">No minutes</Chip>;
  if (m.summary && !m.summary.checkedBy) return <Chip tone="warn">Summary to check</Chip>;
  return <Chip tone="ok">Minutes in</Chip>;
}

function MeetingDrawer({ r, reader, onClose }: { r: Row; reader: Meetings['reader']; onClose: () => void }) {
  const m = r.meeting;
  const act = useAction();
  const [minutes, setMinutes] = useState('');
  const past = m.start <= new Date().toISOString();
  return (
    <Drawer title={m.title} sub={`${r.companyName} · ${dateTimeLabel(m.start)} · ${m.location}`} onClose={onClose}>
      <section>
        <div className="muted small">Organised by {m.organiser}</div>
        {m.attendees.length > 0 && <div className="small">Attending: {m.attendees.join(', ')}</div>}
      </section>
      {r.carried.length > 0 && (
        <section>
          <h3>Open actions from the last meeting</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {r.carried.map((a, i) => (
              <li key={i}>
                {a.text} · {a.owner}
                {a.due ? ` · due ${a.due}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Agenda</h3>
        {r.agendaItems.length === 0 ? (
          <div className="empty">No agenda given.</div>
        ) : (
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {r.agendaItems.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        )}
      </section>
      {m.status === 'scheduled' && <PrepChecklist r={r} />}
      {m.summary && (
        <section>
          <h3>Summary {m.summary.checkedBy ? <Chip tone="ok">Checked by {m.summary.checkedBy}</Chip> : <Chip tone="warn">Not checked yet</Chip>}</h3>
          <p>{m.summary.text}</p>
          <div className="muted small">{m.summary.reader}</div>
          <h3>Action items</h3>
          <div className="list">
            {m.summary.actions.length === 0 && <div className="empty">No action items found.</div>}
            {m.summary.actions.map((a, i) => (
              <div key={i} className="list-item">
                <div>
                  <div
                    style={{
                      textDecoration: a.done ? 'line-through' : undefined,
                    }}
                  >
                    {a.text}
                  </div>
                  <div className="muted small">
                    {a.owner}
                    {a.due ? ` · by ${dateLabel(a.due)}` : ''}
                  </div>
                </div>
                {r.canRun ? (
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.setMeetingAction(m.id, i, !a.done), a.done ? 'Reopened.' : 'Marked done.')}
                  >
                    {a.done ? 'Reopen' : 'Done'}
                  </button>
                ) : (
                  <Chip tone={a.done ? 'ok' : 'warn'}>{a.done ? 'Done' : 'Open'}</Chip>
                )}
              </div>
            ))}
          </div>
          {r.canCheck && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 8 }}
              disabled={act.busy}
              onClick={() => act.run(() => api.checkMeetingSummary(m.id, {}), 'Summary checked.')}
            >
              Summary is right
            </button>
          )}
        </section>
      )}
      {m.minutes && (
        <section>
          <h3>Minutes</h3>
          <div className="muted small">
            {m.minutes.by}, {dateTimeLabel(m.minutes.at)}
          </div>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {m.minutes.text}
          </pre>
        </section>
      )}
      {!m.minutes && r.canRun && past && (
        <section>
          <h3>Add the minutes</h3>
          <textarea
            className="input"
            rows={8}
            aria-label="Minutes"
            placeholder={'Paste the minutes. Start action items with "Action:" and end with (Owner, by YYYY-MM-DD).'}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <div className="muted small">
            {reader.usesAi
              ? `The AI agent (${reader.name}) drafts the summary and action items.`
              : 'Test version: a simple reader picks the first points and the "Action:" lines; the AI agent is not connected yet.'}
          </div>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 8 }}
            disabled={act.busy || minutes.trim().length < 20}
            onClick={() => act.run(() => api.addMinutes(m.id, minutes), 'Minutes saved and summarised.')}
          >
            Save minutes
          </button>
        </section>
      )}
      {!m.minutes && !past && <p className="muted">Minutes are added after the meeting.</p>}
      <ErrorNotice error={act.error} />
    </Drawer>
  );
}

function PrepChecklist({ r }: { r: Row }) {
  const act = useAction();
  const [add, setAdd] = useState('');
  const m = r.meeting;
  const done = r.prep.filter((x) => x.done).length;
  return (
    <section>
      <h3>
        Pre-briefing checklist{' '}
        <Chip tone={r.prepState === 'ready' ? 'ok' : r.prepState === 'late' ? 'crit' : 'warn'}>
          {done} of {r.prep.length} done
        </Chip>
      </h3>
      {r.prepState === 'late' && (
        <div className="notice" data-tone="warn">
          The meeting is within 24 hours and the pre-brief is not finished.
        </div>
      )}
      <div className="list">
        {r.prep.map((x, i) => (
          <label
            key={i}
            className="list-item"
            style={{
              gap: 8,
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
            }}
          >
            <input
              type="checkbox"
              checked={x.done}
              disabled={!r.canRun || act.busy}
              onChange={(e) =>
                act.run(
                  () =>
                    api.setMeetingPrep(m.id, {
                      index: i,
                      done: e.target.checked,
                    }),
                  e.target.checked ? 'Ticked.' : 'Unticked.',
                )
              }
            />
            <div style={{ minWidth: 0 }}>
              <div>{x.label}</div>
              {x.done && x.by && (
                <div className="muted small">
                  {x.by}
                  {x.at ? `, ${dateTimeLabel(x.at)}` : ''}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
      {r.canRun && (
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Add a checklist item" placeholder="Add your own item" value={add} onChange={(e) => setAdd(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !add.trim()}
            onClick={() =>
              act
                .run(() => api.setMeetingPrep(m.id, { add }), 'Item added.')
                .then((x) => {
                  if (x) setAdd('');
                })
            }
          >
            Add
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}

function NewMeeting({ doa, onClose }: { doa: boolean; onClose: () => void }) {
  const { companyId, company, me } = useApp();
  const isCompanyUser = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  const [forCompany, setForCompany] = useState(isCompanyUser);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<keyof typeof MEETING_KIND>('management');
  const [date, setDate] = useState(new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10));
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('11:00');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [agenda, setAgenda] = useState('');
  const [repeat, setRepeat] = useState<keyof typeof REPEAT>('');
  const [times, setTimes] = useState('');
  const act = useAction();
  return (
    <Drawer title="New meeting" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {doa && (
          <label className="field">
            <span className="label">For</span>
            <select className="select" value={forCompany ? 'company' : 'group'} onChange={(e) => setForCompany(e.target.value === 'company')} aria-label="For">
              <option value="group">The group (Director Office)</option>
              <option value="company">{company?.name ?? 'This company'}</option>
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">Title</span>
          <input className="input" aria-label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Kind</span>
          <select
            className="select"
            aria-label="Kind of meeting"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as keyof typeof MEETING_KIND;
              setKind(k);
              if (k === 'toolbox' && !repeat) setRepeat('fortnightly');
            }}
          >
            {Object.entries(MEETING_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <label className="field">
              <span className="label">From</span>
              <input className="input" type="time" aria-label="Start time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">To</span>
              <input className="input" type="time" aria-label="End time" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <label className="field">
            <span className="label">Repeats</span>
            <select className="select" aria-label="Repeats" value={repeat} onChange={(e) => setRepeat(e.target.value as keyof typeof REPEAT)}>
              {Object.entries(REPEAT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {repeat && (
            <label className="field">
              <span className="label">How many meetings</span>
              <input
                className="input"
                type="number"
                min={2}
                max={26}
                aria-label="How many meetings"
                placeholder="Default"
                value={times}
                onChange={(e) => setTimes(e.target.value)}
              />
            </label>
          )}
        </div>
        <label className="field">
          <span className="label">Where</span>
          <input className="input" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room, office or Teams" />
        </label>
        <label className="field">
          <span className="label">Who attends</span>
          <input
            className="input"
            aria-label="Attendees"
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            placeholder="Names, separated by commas"
          />
        </label>
        <label className="field">
          <span className="label">Agenda, one item per line</span>
          <textarea
            className="input"
            rows={4}
            aria-label="Agenda"
            placeholder={'1. Actions from the last meeting\n2. …'}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
        </label>
        <p className="muted small">A pre-briefing checklist for this kind of meeting is added when you save. Tick it off before the meeting.</p>
        <ErrorNotice error={act.error} />
        <div>
          <button
            className="btn btn-primary"
            disabled={act.busy || !title.trim() || !agenda.trim()}
            onClick={async () => {
              const r = await act.run(
                () =>
                  api.scheduleMeeting({
                    companyId: forCompany ? companyId : null,
                    kind,
                    title,
                    start: myt(date, from),
                    end: myt(date, to),
                    location,
                    attendees: attendees
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                    agenda,
                    repeat: repeat || null,
                    ...(repeat && times ? { times: Number(times) } : {}),
                  }),
                repeat ? 'Meetings set. Add them to Outlook from the calendar.' : 'Meeting set. Add it to Outlook from the calendar.',
              );
              if (r) onClose();
            }}
          >
            Save meeting
          </button>
        </div>
      </div>
    </Drawer>
  );
}
