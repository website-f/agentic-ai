import { useState } from 'react';
import { CalendarBlankIcon, ChecksIcon, ClipboardTextIcon, ClockCountdownIcon, NotePencilIcon, PlusIcon } from '@phosphor-icons/react';
import { myt } from '@prima/core';
import { api, type Meetings } from '../api';
import { useApp } from '../App';
import { saveFile } from '../save';
import { Chip, notify, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, Facts, PageHead, Person, Stat, Stats } from '../kit';
import '../styles/leadership.css';

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

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A calendar leaf for a YYYY-MM-DD date: weekday, day and month. */
function DateLeaf({ date }: { date: string }) {
  const dt = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return (
    <span className="ld-leaf" aria-hidden="true">
      <span className="ld-leaf-wd">{WDAY[dt.getUTCDay()]}</span>
      <span className="ld-leaf-d">{dt.getUTCDate()}</span>
      <span className="ld-leaf-m">{MON[dt.getUTCMonth()]}</span>
    </span>
  );
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
  const now = new Date().toISOString();
  const noMinutes = data.rows.filter((r) => r.meeting.status !== 'cancelled' && !r.meeting.minutes && r.meeting.end < now).length;
  // Upcoming first, soonest at the top; then what was held, latest first.
  const upcoming = data.rows.filter((r) => r.meeting.end >= now).sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
  const past = data.rows.filter((r) => r.meeting.end < now).sort((a, b) => b.meeting.start.localeCompare(a.meeting.start));
  // The calendar grouped by day.
  const days: [string, Deadline[]][] = [];
  for (const d of data.deadlines) {
    const last = days[days.length - 1];
    if (last && last[0] === d.date) last[1].push(d);
    else days.push([d.date, [d]]);
  }
  const meetingRow = (r: Row) => (
    <li key={r.meeting.id}>
      <button type="button" className="ld-agenda-row" onClick={() => setOpen(r.meeting.id)}>
        <DateLeaf date={r.meeting.start} />
        <span className="ld-row-main">
          <span className="ld-row-title">{r.meeting.title}</span>
          <span className="ld-row-meta">
            {dateLabel(r.meeting.start.slice(0, 10))} {hhmm(r.meeting.start)} · {r.companyName} · {MEETING_KIND[r.meeting.kind]}
          </span>
        </span>
        <span className="ld-row-aside">
          <MeetingChip r={r} />
        </span>
      </button>
    </li>
  );
  return (
    <div className="page ld">
      <PageHead
        title="Meetings and deadlines"
        sub="Every meeting with its minutes and summary, and the dates that matter: meetings, action items, tender closing dates and reports due."
        actions={
          data.canSchedule && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" /> New meeting
            </button>
          )
        }
      />
      <Stats>
        <Stat label="Dates in next 60 days" value={data.deadlines.length} icon={<CalendarBlankIcon />} tone="info" onClick={() => setTab('calendar')} />
        <Stat
          label="Action items overdue"
          value={data.overdueActions.length}
          tone={data.overdueActions.length ? 'crit' : 'ok'}
          icon={<ClockCountdownIcon />}
        />
        <Stat label="Held, no minutes yet" value={noMinutes} tone={noMinutes ? 'warn' : 'ok'} icon={<NotePencilIcon />} onClick={() => setTab('meetings')} />
        <Stat
          label="Within 24 hours, pre-brief not done"
          value={data.prepNotReady}
          tone={data.prepNotReady ? 'crit' : 'ok'}
          icon={<ClipboardTextIcon />}
          onClick={() => setTab('meetings')}
        />
        {data.doa && (
          <Stat label="Summaries to check" value={toCheck} tone={toCheck ? 'warn' : 'ok'} icon={<ChecksIcon />} onClick={() => setTab('meetings')} />
        )}
      </Stats>
      <div className="tabbar" role="tablist" aria-label="Meetings sections">
        <button role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Calendar
        </button>
        <button role="tab" aria-selected={tab === 'meetings'} onClick={() => setTab('meetings')}>
          Meetings and minutes
        </button>
      </div>
      {tab === 'calendar' && (
        <Card
          title="Next 60 days"
          actions={
            <button className="btn btn-sm" disabled={!data.deadlines.length} onClick={() => download(data.deadlines, 'prima-deadlines.ics')}>
              Add all to Outlook
            </button>
          }
          footer={
            <p className="muted small ld-foot-text">
              Opens as a calendar file in Outlook, with a reminder the day before. Syncing straight into the Outlook calendar needs the Microsoft 365
              connection, which comes with the live system.
            </p>
          }
          flush
        >
          {data.deadlines.length === 0 ? (
            <Empty title="Nothing in the next 60 days." />
          ) : (
            <ul className="ld-days">
              {days.map(([date, items]) => (
                <li key={date} className="ld-day">
                  <DateLeaf date={date} />
                  <ul className="ld-day-items">
                    {items.map((d, i) => (
                      <li key={i} className="ld-day-item" data-kind={d.kind}>
                        <span className="ld-row-main">
                          <span className="ld-row-title">{d.title}</span>
                          <span className="ld-row-meta">
                            {dateLabel(d.date)}
                            {d.start ? ` · ${hhmm(d.start)}–${hhmm(d.end)}` : ''} · {d.detail}
                          </span>
                        </span>
                        <span className="ld-row-aside">
                          <Chip tone={KIND[d.kind].tone}>{KIND[d.kind].label}</Chip>
                          <button className="btn btn-sm btn-ghost" aria-label={`Add ${d.title} to Outlook`} onClick={() => download([d], 'prima-date.ics')}>
                            Outlook
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'meetings' &&
        (data.rows.length === 0 ? (
          <Card>
            <Empty
              title="No meetings yet."
              action={
                data.canSchedule && (
                  <button className="btn btn-primary" onClick={() => setCreating(true)}>
                    <PlusIcon size={16} weight="bold" aria-hidden="true" /> New meeting
                  </button>
                )
              }
            >
              {data.canSchedule ? 'Set the first meeting; its minutes and action items are kept here after it is held.' : undefined}
            </Empty>
          </Card>
        ) : (
          <>
            <Card title="Upcoming" actions={<Chip tone="info">{upcoming.length}</Chip>} flush>
              {upcoming.length === 0 ? <Empty title="No meetings coming up." /> : <ul className="ld-rows">{upcoming.map(meetingRow)}</ul>}
            </Card>
            {past.length > 0 && (
              <Card title="Past meetings" sub="Minutes, summaries and action items" actions={<Chip tone="neutral">{past.length}</Chip>} flush>
                <ul className="ld-rows">{past.map(meetingRow)}</ul>
              </Card>
            )}
          </>
        ))}
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
      <div className="ld-detail">
        <section className="ld-detail-sec">
          <div className="ld-detail-top">
            <MeetingChip r={r} />
            <Chip tone="neutral">{MEETING_KIND[m.kind]}</Chip>
          </div>
          <Facts
            items={[
              ['When', `${dateTimeLabel(m.start)}–${hhmm(m.end)}`],
              ['Where', m.location || '–'],
              ['Organised by', m.organiser],
              ['Company', r.companyName],
            ]}
          />
          {m.attendees.length > 0 && (
            <div className="ld-attendees">
              <span className="label">Attending</span>
              <ul className="ld-people">
                {m.attendees.map((a, i) => (
                  <li key={i}>
                    <Person name={a} size={26} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {r.carried.length > 0 && (
          <section className="ld-detail-sec">
            <h3>Open actions from the last meeting</h3>
            <ul className="ld-actionlist">
              {r.carried.map((a, i) => (
                <li key={i} className="ld-action-item">
                  <span className="ld-row-main">
                    <span className="ld-row-text">{a.text}</span>
                    <span className="ld-action-who">
                      <Person name={a.owner} size={22} />
                      {a.due && <span className="muted small">due {a.due}</span>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="ld-detail-sec">
          <h3>Agenda</h3>
          {r.agendaItems.length === 0 ? (
            <p className="muted small">No agenda given.</p>
          ) : (
            <ol className="ld-agenda">
              {r.agendaItems.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          )}
        </section>

        {m.status === 'scheduled' && <PrepChecklist r={r} />}

        {m.summary && (
          <section className="ld-detail-sec">
            <div className="ld-detail-h">
              <h3>Summary</h3>
              {m.summary.checkedBy ? <Chip tone="ok">Checked by {m.summary.checkedBy}</Chip> : <Chip tone="warn">Not checked yet</Chip>}
            </div>
            <p className="ld-prose">{m.summary.text}</p>
            <p className="muted small">{m.summary.reader}</p>
            {r.canCheck && (
              <div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.checkMeetingSummary(m.id, {}), 'Summary checked.')}
                >
                  Summary is right
                </button>
              </div>
            )}
          </section>
        )}

        {m.summary && (
          <section className="ld-detail-sec">
            <div className="ld-detail-h">
              <h3>Action items</h3>
              <Chip tone={m.summary.actions.some((a) => !a.done) ? 'warn' : 'ok'}>
                {m.summary.actions.filter((a) => a.done).length} of {m.summary.actions.length} done
              </Chip>
            </div>
            {m.summary.actions.length === 0 ? (
              <p className="muted small">No action items found.</p>
            ) : (
              <ul className="ld-actionlist">
                {m.summary.actions.map((a, i) => (
                  <li key={i} className="ld-action-item" data-done={a.done}>
                    <span className="ld-row-main">
                      <span className="ld-row-text ld-action-text">{a.text}</span>
                      <span className="ld-action-who">
                        <Person name={a.owner} size={22} />
                        {a.due && <span className="muted small">by {dateLabel(a.due)}</span>}
                      </span>
                    </span>
                    <span className="ld-row-aside">
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
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {r.canRun && <AddAction meetingId={m.id} />}
          </section>
        )}

        {m.minutes && (
          <section className="ld-detail-sec">
            <div className="ld-detail-h">
              <h3>Minutes</h3>
              <span className="muted small">
                {m.minutes.by}, {dateTimeLabel(m.minutes.at)}
              </span>
            </div>
            <pre className="ld-minutes">{m.minutes.text}</pre>
          </section>
        )}

        {!m.minutes && r.canRun && past && (
          <section className="ld-detail-sec">
            <label className="field">
              <span className="label">Add the minutes</span>
              <textarea
                className="textarea"
                rows={8}
                aria-label="Minutes"
                placeholder={'Paste the minutes. Start action items with "Action:" and end with (Owner, by YYYY-MM-DD).'}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <p className="muted small">
              {reader.usesAi
                ? `The AI agent (${reader.name}) drafts the summary and action items.`
                : 'Test version: a simple reader picks the first points and the "Action:" lines; the AI agent is not connected yet.'}
            </p>
            <div>
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || minutes.trim().length < 20}
                onClick={() => act.run(() => api.addMinutes(m.id, minutes), 'Minutes saved and summarised.')}
              >
                Save minutes
              </button>
            </div>
          </section>
        )}
        {!m.minutes && !past && <p className="muted small">Minutes are added after the meeting.</p>}
        <ErrorNotice error={act.error} />
      </div>
    </Drawer>
  );
}

/** Add an action item the minutes reader missed: what, who and by when. */
function AddAction({ meetingId }: { meetingId: string }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  if (!open)
    return (
      <div>
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          <PlusIcon size={14} weight="bold" aria-hidden="true" /> Add an action item
        </button>
      </div>
    );
  return (
    <div className="ld-subpanel">
      <div className="ld-form">
        <label className="field">
          <span className="label">What has to be done</span>
          <input className="input" aria-label="Action item" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Who does it</span>
          <input className="input" aria-label="Action owner" placeholder="Name" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">By when (optional)</span>
          <input className="input" type="date" aria-label="Action due date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {text.trim().length > 0 && text.trim().length < 3 && <p className="help">Say a little more about what has to be done.</p>}
      <ErrorNotice error={act.error} />
      <div className="ld-actions">
        <button className="btn btn-sm" disabled={act.busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || text.trim().length < 3 || !owner.trim()}
          onClick={async () => {
            const r = await act.run(() => api.addMeetingAction(meetingId, { text, owner, due: due || null }), 'Action item added.');
            if (r) {
              setText('');
              setOwner('');
              setDue('');
              setOpen(false);
            }
          }}
        >
          {act.busy ? 'Saving…' : 'Add action item'}
        </button>
      </div>
    </div>
  );
}

function PrepChecklist({ r }: { r: Row }) {
  const act = useAction();
  const [add, setAdd] = useState('');
  const m = r.meeting;
  const done = r.prep.filter((x) => x.done).length;
  return (
    <section className="ld-detail-sec">
      <div className="ld-detail-h">
        <h3>Pre-briefing checklist</h3>
        <Chip tone={r.prepState === 'ready' ? 'ok' : r.prepState === 'late' ? 'crit' : 'warn'}>
          {done} of {r.prep.length} done
        </Chip>
      </div>
      {r.prep.length > 0 && (
        <span className="ld-bar" aria-hidden="true">
          <span style={{ width: `${Math.round((done / r.prep.length) * 100)}%` }} />
        </span>
      )}
      {r.prepState === 'late' && (
        <div className="notice" data-tone="warn">
          The meeting is within 24 hours and the pre-brief is not finished.
        </div>
      )}
      <ul className="ld-checklist">
        {r.prep.map((x, i) => (
          <li key={i}>
            <label className="ld-check" data-done={x.done}>
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
              <span className="ld-check-text">
                <span>{x.label}</span>
                {x.done && x.by && (
                  <span className="muted small">
                    {x.by}
                    {x.at ? `, ${dateTimeLabel(x.at)}` : ''}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {r.canRun && (
        <div className="ld-inline-add">
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
  // A Director Office meeting may be for any company the person can see, not only the one open now.
  const [target, setTarget] = useState(companyId);
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
      <div className="ld-editor">
        {doa && (
          <label className="field">
            <span className="label">For</span>
            <select
              className="select"
              value={forCompany ? target : 'group'}
              onChange={(e) => {
                setForCompany(e.target.value !== 'group');
                if (e.target.value !== 'group') setTarget(e.target.value);
              }}
              aria-label="For"
            >
              <option value="group">The group (Director Office)</option>
              {(me.companies.length ? me.companies : company ? [company] : []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
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
        <div className="ld-form ld-form-3">
          <label className="field">
            <span className="label">Date</span>
            <input className="input" type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">From</span>
            <input className="input" type="time" aria-label="Start time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">To</span>
            <input className="input" type="time" aria-label="End time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="ld-form">
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
            className="textarea"
            rows={4}
            aria-label="Agenda"
            placeholder={'1. Actions from the last meeting\n2. …'}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
        </label>
        <p className="muted small">A pre-briefing checklist for this kind of meeting is added when you save. Tick it off before the meeting.</p>
        <ErrorNotice error={act.error} />
        <div className="ld-sticky ld-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={act.busy || !title.trim() || !agenda.trim()}
            onClick={async () => {
              const r = await act.run(
                () =>
                  api.scheduleMeeting({
                    companyId: forCompany ? (doa ? target || companyId : companyId) : null,
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
