import { Select } from '../SearchSelect';
import { useMemo, useState } from 'react';
import { CalendarBlankIcon, ChecksIcon, ClipboardTextIcon, ClockCountdownIcon, EnvelopeSimpleIcon, ListChecksIcon, NotePencilIcon, PlusIcon } from '@phosphor-icons/react';
import { myt } from '@prima/core';
import { api, type Meetings } from '../api';
import { useApp } from '../App';
import { saveFile } from '../save';
import { tr, useLang } from '../i18n';
import { Chip, notify, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { Card, Empty, Facts, PageHead, Person, Stat, Stats } from '../kit';
import '../styles/leadership.css';

type Row = Meetings['rows'][number];
type Deadline = Meetings['deadlines'][number];
/** Staff who can be invited: names and job titles only. */
type StaffPick = Meetings['people'][number];
type Section = NonNullable<Meetings['sections']>[number];

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

const ANSWER: Record<'yes' | 'no' | 'maybe', [Tone, string]> = {
  yes: ['ok', 'Attending'],
  no: ['crit', 'Not attending'],
  maybe: ['warn', 'Not sure'],
};

const SECTION_STATE: Record<Section['state'], [Tone, string]> = {
  held: ['ok', 'Held, minutes in'],
  minutes_due: ['warn', 'Held, minutes due'],
  scheduled: ['info', 'Set, coming up'],
  none: ['neutral', 'Not set'],
};

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

const monthLabel = (d = new Date()) => d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

type Draft = {
  sectionKey?: string;
  seriesKey?: string;
  companyId?: string | null;
  title?: string;
  agenda?: string;
  kind?: keyof typeof MEETING_KIND;
  invite?: string[];
  group?: boolean;
};
type PlanRow = Meetings['plan'][number];

const EVERY: Record<PlanRow['every'], string> = {
  fortnight: 'Every two weeks',
  month: 'Every month',
  bimonth: 'Every two months',
  quarter: 'Every quarter',
  year: 'Once a year',
};

/** Meetings across the group: invitations, agenda, pre-brief, minutes, action items and every deadline (Fauzan, 25 Oct and 5 Nov 2026). */
export function MeetingsView() {
  const { lang } = useLang();
  const { data, error } = useLoad(() => api.meetings(), []);
  const [tab, setTab] = useState<'calendar' | 'meetings' | 'mine' | 'plan' | 'sections'>('meetings');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<Draft | null>(null);
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
  const noMinutes = data.rows.filter((r) => r.minutesLateDays > 0).length;
  const now = new Date().toISOString();
  // Upcoming first, soonest at the top; then what was held, latest first.
  const upcoming = data.rows.filter((r) => r.meeting.end >= now).sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
  const past = data.rows.filter((r) => r.meeting.end < now).sort((a, b) => b.meeting.start.localeCompare(a.meeting.start));
  const meetingRow = (r: Row) => (
    <li key={r.meeting.id}>
      <button type="button" className="ld-agenda-row" onClick={() => setOpen(r.meeting.id)}>
        <DateLeaf date={r.meeting.start} />
        <span className="ld-row-main">
          <span className="ld-row-title">{r.meeting.title}</span>
          <span className="ld-row-meta">
            {dateLabel(r.meeting.start.slice(0, 10))} {hhmm(r.meeting.start)} · {r.sectionLabel ?? r.companyName} · {MEETING_KIND[r.meeting.kind]}
          </span>
        </span>
        <span className="ld-row-aside">
          <MeetingChip r={r} />
          {r.myInvite && r.meeting.status === 'scheduled' && !r.myInvite.answer && <Chip tone="warn">Answer the invitation</Chip>}
        </span>
      </button>
    </li>
  );
  const newMeeting = data.canSchedule && (
    <button className="btn btn-primary" onClick={() => setCreating({})}>
      <PlusIcon size={16} weight="bold" aria-hidden="true" /> New meeting
    </button>
  );
  return (
    <div className="page ld">
      <PageHead
        title="Meetings"
        sub="Invitations, agenda, pre-briefing checklist, minutes and action items, and the dates that matter: meetings, actions, tender closing dates and reports due."
        actions={newMeeting}
      />
      <Stats>
        <Stat
          label="Invitations to answer"
          value={data.toAnswer}
          tone={data.toAnswer ? 'warn' : 'ok'}
          icon={<EnvelopeSimpleIcon />}
          onClick={() => setTab('meetings')}
        />
        <Stat
          label="My action items"
          value={data.myActions.length}
          tone={data.myActions.some((a) => a.overdue) ? 'crit' : data.myActions.length ? 'warn' : 'ok'}
          icon={<ListChecksIcon />}
          onClick={() => setTab('mine')}
        />
        <Stat
          label="Action items overdue"
          value={data.overdueActions.length}
          tone={data.overdueActions.length ? 'crit' : 'ok'}
          icon={<ClockCountdownIcon />}
        />
        <Stat label="Held, minutes late" value={noMinutes} tone={noMinutes ? 'warn' : 'ok'} icon={<NotePencilIcon />} onClick={() => setTab('meetings')} />
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
        <Stat label="Dates in next 60 days" value={data.deadlines.length} icon={<CalendarBlankIcon />} tone="info" onClick={() => setTab('calendar')} />
      </Stats>
      <div className="tabbar" role="tablist" aria-label="Meetings sections">
        <button role="tab" aria-selected={tab === 'meetings'} onClick={() => setTab('meetings')}>
          Meetings and minutes
        </button>
        <button role="tab" aria-selected={tab === 'plan'} onClick={() => setTab('plan')}>
          Regular meetings
        </button>
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          My action items
        </button>
        {data.sections && (
          <button role="tab" aria-selected={tab === 'sections'} onClick={() => setTab('sections')}>
            Monthly operations
          </button>
        )}
        <button role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Calendar
        </button>
      </div>
      {tab === 'calendar' && <Calendar data={data} />}
      {tab === 'meetings' &&
        (data.rows.length === 0 ? (
          <Card>
            <Empty title="No meetings yet." action={newMeeting}>
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
      {tab === 'mine' && <MyActions data={data} onOpen={setOpen} />}
      {tab === 'plan' && (
        <Plan
          plan={data.plan}
          onOpen={setOpen}
          onSet={(p) =>
            setCreating({
              seriesKey: p.seriesKey,
              companyId: p.companyId,
              group: !p.companyId,
              kind: p.kind,
              title: `${p.title} (${p.period})`,
              agenda: p.agenda.map((a, i) => `${i + 1}. ${tr(a, lang)}`).join('\n'),
              invite: p.inviteeIds,
            })
          }
        />
      )}
      {tab === 'sections' && data.sections && (
        <Sections
          companies={data.companyMeetings}
          sections={data.sections}
          canSet={data.canSetSection}
          rule={data.sectionRule}
          onOpen={setOpen}
          onSet={(s) =>
            setCreating({
              sectionKey: s.key,
              kind: 'operations',
              group: true,
              title: `Mesyuarat Operasi Bulanan: ${s.label}`,
              agenda: data.sectionRule.agenda.map((a, i) => `${i + 1}. ${a}`).join('\n'),
              invite: s.heads,
            })
          }
        />
      )}
      {row && <MeetingDrawer r={row} people={data.people} onClose={() => setOpen(null)} />}
      {creating && <MeetingForm doa={data.doa} people={data.people} draft={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function Calendar({ data }: { data: Meetings }) {
  // The calendar grouped by day.
  const days: [string, Deadline[]][] = [];
  for (const d of data.deadlines) {
    const last = days[days.length - 1];
    if (last && last[0] === d.date) last[1].push(d);
    else days.push([d.date, [d]]);
  }
  return (
    <Card
      title="Next 60 days"
      actions={
        <button className="btn btn-sm" disabled={!data.deadlines.length} onClick={() => download(data.deadlines, 'prima-deadlines.ics')}>
          Add all to Outlook
        </button>
      }
      footer={
        <p className="muted small ld-foot-text">
          Opens as a calendar file in Outlook, with a reminder the day before. Prima does not send Outlook invitations or emails yet; invited staff see the
          meeting and their reminders here.
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
  );
}

/** The regular meetings this person sets or attends, with this period's state (rule MTG-PLAN). */
function Plan({ plan, onOpen, onSet }: { plan: PlanRow[]; onOpen: (id: string) => void; onSet: (p: PlanRow) => void }) {
  const [only, setOnly] = useState(false);
  const shown = only ? plan.filter((p) => p.state !== 'held') : plan;
  const mine = plan.filter((p) => p.iSet && p.state === 'none').length;
  return (
    <Card
      title="Regular meetings"
      sub={`The meetings your job needs. If you set the meeting, tap "Set it": the title, invitations and agenda are filled in for you, with what is important now at the top.${mine ? ` ${mine} to set now.` : ''}`}
      actions={
        <button className="btn btn-sm" aria-pressed={only} onClick={() => setOnly(!only)}>
          {only ? 'Show all' : 'Only not done'}
        </button>
      }
      flush
    >
      {shown.length === 0 ? (
        <Empty title="No regular meetings for your job." />
      ) : (
        <ul className="ld-rows">
          {shown.map((p) => (
            <li key={p.seriesKey} className="ld-row" data-tone={p.late ? 'crit' : undefined}>
              <span className="ld-row-main">
                <span className="ld-row-title">{p.title}</span>
                <span className="ld-row-meta">
                  {EVERY[p.every]} · {p.start ? `${dateLabel(p.start.slice(0, 10))} ${hhmm(p.start)}` : 'not set for this period'} ·{' '}
                  {p.iSet ? 'You set it' : 'You attend'}
                </span>
                <span className="ld-row-meta">{p.who}</span>
                {p.iSet && p.important.length > 0 && (
                  <ul className="ld-row-text">
                    {p.important.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </span>
              <span className="ld-row-aside">
                <Chip tone={p.late ? 'crit' : SECTION_STATE[p.state][0]}>
                  {SECTION_STATE[p.state][1]}
                  {p.late ? ' (late)' : ''}
                </Chip>
                {p.meetingId ? (
                  <button className="btn btn-sm" onClick={() => onOpen(p.meetingId!)}>
                    Open
                  </button>
                ) : (
                  p.iSet && (
                    <button className="btn btn-sm btn-primary" onClick={() => onSet(p)}>
                      Set it
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MyActions({ data, onOpen }: { data: Meetings; onOpen: (id: string) => void }) {
  return (
    <Card title="Action items given to you" actions={<Chip tone={data.myActions.length ? 'warn' : 'ok'}>{data.myActions.length}</Chip>} flush>
      {data.myActions.length === 0 ? (
        <Empty title="No open action items for you." />
      ) : (
        <ul className="ld-rows">
          {data.myActions.map((a) => (
            <li key={`${a.meetingId}-${a.index}`}>
              <button type="button" className="ld-row" data-tone={a.overdue ? 'crit' : undefined} onClick={() => onOpen(a.meetingId)}>
                <span className="ld-row-main">
                  <span className="ld-row-title">{a.text}</span>
                  <span className="ld-row-meta">
                    From {a.meeting}
                    {a.due ? ` · by ${dateLabel(a.due)}` : ''}
                  </span>
                </span>
                <span className="ld-row-aside">
                  <Chip tone={a.overdue ? 'crit' : 'warn'}>{a.overdue ? 'Overdue' : 'Open'}</Chip>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const COMPANY_STATE: Record<Meetings['companyMeetings'][number]['state'], [Tone, string]> = {
  held: ['ok', 'Held, minutes in'],
  scheduled: ['info', 'Set, coming up'],
  none: ['neutral', 'Not set'],
};

function Sections({
  companies,
  sections,
  canSet,
  rule,
  onOpen,
  onSet,
}: {
  companies: Meetings['companyMeetings'];
  sections: Section[];
  canSet: boolean;
  rule: Meetings['sectionRule'];
  onOpen: (id: string) => void;
  onSet: (s: Section) => void;
}) {
  const done = sections.filter((s) => s.state === 'held').length;
  return (
    <>
      <Card
        title={`COO monthly operations meetings, ${monthLabel()}`}
        sub={`One meeting a month with each operations section. Set it by day ${rule.scheduleByDay} of the month; file the minutes within ${rule.minutesWithinDays} days. Reminders stay on the COO's home until the minutes are in.`}
        actions={<Chip tone={done === sections.length ? 'ok' : 'warn'}>{`${done} of ${sections.length} done`}</Chip>}
        flush
      >
        <ul className="ld-rows">
          {sections.map((s) => (
            <li key={s.key} className="ld-row" data-tone={s.late ? 'crit' : undefined}>
              <span className="ld-row-main">
                <span className="ld-row-title">{s.label}</span>
                <span className="ld-row-meta">{s.start ? `${dateLabel(s.start.slice(0, 10))} ${hhmm(s.start)}` : 'No meeting this month yet'}</span>
              </span>
              <span className="ld-row-aside">
                <Chip tone={s.late ? 'crit' : SECTION_STATE[s.state][0]}>{s.late ? `${SECTION_STATE[s.state][1]}, late` : SECTION_STATE[s.state][1]}</Chip>
                {s.meetingId ? (
                  <button className="btn btn-sm" onClick={() => onOpen(s.meetingId!)}>
                    Open
                  </button>
                ) : (
                  canSet && (
                    <button className="btn btn-sm btn-primary" onClick={() => onSet(s)}>
                      Set this month's meeting
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {companies.length > 0 && (
        <Card title="Each company's operations" sub="The company office sets its own monthly operations meeting (kind Operations) in Meetings." flush>
          <ul className="ld-rows">
            {companies.map((c) => (
              <li key={c.companyId} className="ld-row">
                <span className="ld-row-main">
                  <span className="ld-row-title">{c.companyName}</span>
                </span>
                <span className="ld-row-aside">
                  <Chip tone={COMPANY_STATE[c.state][0]}>{COMPANY_STATE[c.state][1]}</Chip>
                  {c.meetingId && (
                    <button className="btn btn-sm" onClick={() => onOpen(c.meetingId!)}>
                      Open
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function MeetingChip({ r }: { r: Row }) {
  const m = r.meeting;
  if (m.status === 'cancelled') return <Chip tone="neutral">Cancelled</Chip>;
  if (m.status === 'scheduled' && m.end > new Date().toISOString()) {
    const done = r.prep.filter((x) => x.done).length;
    if (r.prepState === 'ready') return <Chip tone="ok">Pre-brief ready</Chip>;
    return <Chip tone={r.prepState === 'late' ? 'crit' : 'info'}>{`Pre-brief ${done} of ${r.prep.length}`}</Chip>;
  }
  if (!m.minutes) return <Chip tone={r.minutesLateDays ? 'crit' : 'warn'}>{r.minutesLateDays ? `Minutes ${r.minutesLateDays} days late` : 'Minutes due'}</Chip>;
  if (m.summary && !m.summary.checkedBy) return <Chip tone="warn">Summary to check</Chip>;
  return <Chip tone="ok">Minutes in</Chip>;
}

function MeetingDrawer({ r, people, onClose }: { r: Row; people: StaffPick[]; onClose: () => void }) {
  const m = r.meeting;
  const [mode, setMode] = useState<'view' | 'change' | 'cancel'>('view');
  const past = m.start <= new Date().toISOString();
  if (mode === 'change') return <MeetingForm doa={false} people={people} edit={r} onClose={() => setMode('view')} />;
  return (
    <Drawer title={m.title} sub={`${r.sectionLabel ?? r.companyName} · ${dateTimeLabel(m.start)} · ${m.location}`} onClose={onClose}>
      <div className="ld-detail">
        {m.status === 'cancelled' && m.cancelled && (
          <div className="notice" data-tone="warn">
            Cancelled by {m.cancelled.by}, {dateTimeLabel(m.cancelled.at)}: {m.cancelled.reason}
          </div>
        )}
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
              ['For', r.sectionLabel ?? r.companyName],
            ]}
          />
          {r.myInvite && m.status === 'scheduled' && !past && <MyAnswer r={r} />}
        </section>

        <section className="ld-detail-sec">
          <h3>Invited</h3>
          {r.invited.length === 0 && m.attendees.length === 0 && <p className="muted small">Nobody invited on record.</p>}
          {r.invited.length > 0 && (
            <ul className="ld-actionlist">
              {r.invited.map((p) => (
                <li key={p.userId} className="ld-action-item">
                  <span className="ld-row-main">
                    <Person name={p.name} sub={p.note || undefined} size={26} />
                  </span>
                  <span className="ld-row-aside">
                    {p.answer ? <Chip tone={ANSWER[p.answer][0]}>{ANSWER[p.answer][1]}</Chip> : <Chip tone="neutral">No answer yet</Chip>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {m.attendees.length > 0 && (
            <div className="ld-attendees">
              <span className="label">Guests and others</span>
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
            <h3>Still open from the last meeting</h3>
            <ul className="ld-actionlist">
              {r.carried.map((a) => (
                <li key={`${a.meetingId}-${a.index}`} className="ld-action-item" data-done={a.done}>
                  <span className="ld-row-main">
                    <span className="ld-row-text ld-action-text">{a.text}</span>
                    <span className="ld-action-who">
                      <Person name={a.owner} size={22} />
                      <span className="muted small">
                        {a.due ? `by ${dateLabel(a.due)} · ` : ''}
                        {dateLabel(a.meetingStart.slice(0, 10))}
                      </span>
                    </span>
                  </span>
                  <span className="ld-row-aside">
                    <Chip tone="warn">Open</Chip>
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

        {m.status === 'scheduled' && !past && <PrepChecklist r={r} />}
        {m.summary && <Summary r={r} people={people} />}

        {m.attendance && m.attendance.length > 0 && (
          <section className="ld-detail-sec">
            <h3>Attendance</h3>
            <Facts
              items={(['present', 'apology', 'absent'] as const)
                .map((st) => [st === 'present' ? 'Present' : st === 'apology' ? 'Apology' : 'Absent', m.attendance!.filter((a) => a.state === st).map((a) => a.name)] as const)
                .filter(([, names]) => names.length > 0)
                .map(([label, names]) => [label, names.join(', ')])}
            />
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
        {r.canRun && past && m.status !== 'cancelled' && (!m.minutes || !m.summary?.checkedBy) && <AddMinutes r={r} />}
        {!m.minutes && !past && m.status === 'scheduled' && <p className="muted small">Minutes are added after the meeting.</p>}

        {(m.changes ?? []).length > 0 && (
          <section className="ld-detail-sec">
            <h3>Changes</h3>
            <ul className="ld-actionlist">
              {m.changes!.map((c, i) => (
                <li key={i} className="ld-action-item">
                  <span className="ld-row-main">
                    <span className="ld-row-text">
                      {c.what}: {c.reason}
                    </span>
                    <span className="muted small">
                      {c.by}, {dateTimeLabel(c.at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {r.canChange && mode === 'view' && (
          <div className="ld-actions">
            <button className="btn btn-sm" onClick={() => setMode('cancel')}>
              Cancel the meeting
            </button>
            <button className="btn btn-sm" onClick={() => setMode('change')}>
              Change date, place, agenda or invitees
            </button>
          </div>
        )}
        {mode === 'cancel' && <CancelMeeting r={r} onDone={() => setMode('view')} />}
      </div>
    </Drawer>
  );
}

function MyAnswer({ r }: { r: Row }) {
  const act = useAction();
  const [no, setNo] = useState(false);
  const [why, setWhy] = useState('');
  const mine = r.myInvite?.answer ?? null;
  return (
    <div className="ld-subpanel">
      <h3>{mine ? `Your answer: ${ANSWER[mine][1]}` : 'You are invited. Are you attending?'}</h3>
      <div className="ld-actions">
        <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.answerMeeting(r.meeting.id, 'maybe', ''), 'Answer saved.')}>
          Not sure yet
        </button>
        <button className="btn btn-sm" disabled={act.busy} onClick={() => setNo(true)}>
          Not attending
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={() => act.run(() => api.answerMeeting(r.meeting.id, 'yes', ''), 'Answer saved.')}
        >
          Attending
        </button>
      </div>
      {no && (
        <div className="ld-inline-add">
          <input
            className="input"
            aria-label="Reason for not attending"
            placeholder="Why you cannot attend"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy || why.trim().length < 3}
            onClick={() =>
              act
                .run(() => api.answerMeeting(r.meeting.id, 'no', why), 'Answer saved.')
                .then((x) => {
                  if (x) setNo(false);
                })
            }
          >
            Send
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function CancelMeeting({ r, onDone }: { r: Row; onDone: () => void }) {
  const act = useAction();
  const [why, setWhy] = useState('');
  return (
    <section className="ld-detail-sec">
      <label className="field">
        <span className="label">Cancel the meeting: why</span>
        <textarea
          className="textarea"
          rows={2}
          aria-label="Reason for cancelling"
          placeholder="Why it is cancelled"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="ld-actions">
        <button className="btn btn-sm" onClick={onDone}>
          Keep the meeting
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || why.trim().length < 5}
          onClick={() =>
            act
              .run(() => api.cancelMeeting(r.meeting.id, why), 'Meeting cancelled.')
              .then((x) => {
                if (x) onDone();
              })
          }
        >
          Cancel it
        </button>
      </div>
    </section>
  );
}

function Summary({ r, people }: { r: Row; people: StaffPick[] }) {
  const m = r.meeting;
  const s = m.summary!;
  const act = useAction();
  const { me } = useApp();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<Record<number, string>>({});
  return (
    <>
      <section className="ld-detail-sec">
        <div className="ld-detail-h">
          <h3>Summary</h3>
          {s.checkedBy ? <Chip tone="ok">Checked by {s.checkedBy}</Chip> : <Chip tone="warn">Not checked yet</Chip>}
        </div>
        <p className="ld-prose">{s.text}</p>
        <p className="muted small">Drafted automatically from the minutes; the Director Office checks it.</p>
      </section>
      <section className="ld-detail-sec">
        <div className="ld-detail-h">
          <h3>Action items</h3>
          <Chip tone={s.actions.some((a) => !a.done) ? 'warn' : 'ok'}>
            {s.actions.filter((a) => a.done).length} of {s.actions.length} done
          </Chip>
        </div>
        {editing ? (
          <EditActions r={r} people={people} onDone={() => setEditing(false)} />
        ) : s.actions.length === 0 ? (
          <p className="muted small">No action items found.</p>
        ) : (
          <ul className="ld-actionlist">
            {s.actions.map((a, i) => {
              const mine = a.ownerId === me.user.id;
              return (
                <li key={i} className="ld-action-item" data-done={a.done}>
                  <span className="ld-row-main">
                    <span className="ld-row-text ld-action-text">{a.text}</span>
                    <span className="ld-action-who">
                      <Person name={a.owner} size={22} />
                      <span className="muted small">
                        {a.ownerId ? '' : '(not linked to a staff account) '}
                        {a.due ? `by ${dateLabel(a.due)}` : ''}
                        {a.done && a.doneBy ? ` · done by ${a.doneBy}${a.doneNote ? `: ${a.doneNote}` : ''}` : ''}
                      </span>
                    </span>
                    {(r.canRun || mine) && !a.done && (
                      <input
                        className="input"
                        aria-label={`What was done: ${a.text}`}
                        placeholder="What was done (optional)"
                        value={note[i] ?? ''}
                        onChange={(e) => setNote({ ...note, [i]: e.target.value })}
                      />
                    )}
                  </span>
                  <span className="ld-row-aside">
                    {r.canRun || mine ? (
                      <button
                        className="btn btn-sm"
                        disabled={act.busy}
                        onClick={() => act.run(() => api.setMeetingAction(m.id, i, !a.done, note[i] ?? ''), a.done ? 'Reopened.' : 'Marked done.')}
                      >
                        {a.done ? 'Reopen' : 'Done'}
                      </button>
                    ) : (
                      <Chip tone={a.done ? 'ok' : 'warn'}>{a.done ? 'Done' : 'Open'}</Chip>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!editing && r.canRun && <AddAction meetingId={m.id} />}
        {r.canCheck && !editing && (
          <div className="ld-actions">
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Correct the action items
            </button>
            <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.checkMeetingSummary(m.id, {}), 'Summary checked.')}>
              Summary is right
            </button>
          </div>
        )}
        <ErrorNotice error={act.error} />
      </section>
    </>
  );
}

function EditActions({ r, people, onDone }: { r: Row; people: StaffPick[]; onDone: () => void }) {
  const act = useAction();
  const s = r.meeting.summary!;
  const [rows, setRows] = useState(s.actions.map((a) => ({ text: a.text, owner: a.owner, ownerId: a.ownerId ?? '', due: a.due ?? '' })));
  const choices = useMemo(() => {
    const invited = r.invited.map((p) => ({ id: p.userId, name: p.name }));
    const extra = people.filter((p) => !invited.some((x) => x.id === p.id)).map((p) => ({ id: p.id, name: p.name }));
    return [...invited, ...extra];
  }, [r.invited, people]);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="ld-subpanel">
      {rows.map((a, i) => (
        <div key={i} className="ld-form ld-form-3">
          <label className="field ld-span">
            <span className="label">Action {i + 1}</span>
            <input className="input" aria-label={`Action ${i + 1}`} value={a.text} onChange={(e) => set(i, { text: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Who does it</span>
            <Select className="select" aria-label={`Owner of action ${i + 1}`} value={a.ownerId} onChange={(e) => set(i, { ownerId: e.target.value })}>
              <option value="">{a.owner || 'Not named'} (not linked)</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="label">By when</span>
            <input className="input" type="date" aria-label={`Due date of action ${i + 1}`} value={a.due} onChange={(e) => set(i, { due: e.target.value })} />
          </label>
          <div className="ld-actions">
            <button className="btn btn-sm btn-ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <ErrorNotice error={act.error} />
      <div className="ld-actions">
        <button className="btn btn-sm" onClick={() => setRows([...rows, { text: '', owner: '', ownerId: '', due: '' }])}>
          <PlusIcon size={14} weight="bold" aria-hidden="true" /> Add an action
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Back
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || rows.some((x) => !x.text.trim())}
          onClick={() =>
            act
              .run(
                () =>
                  api.checkMeetingSummary(r.meeting.id, {
                    actions: rows.map((x) => ({ text: x.text, owner: x.owner, ownerId: x.ownerId || null, due: x.due || null })),
                  }),
                'Summary checked with your corrections.',
              )
              .then((x) => {
                if (x) onDone();
              })
          }
        >
          Save and mark checked
        </button>
      </div>
    </div>
  );
}

/** Add an action item the minutes reader missed: what, who and by when (office P78: the organiser adds it without waiting for the check). */
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

function AddMinutes({ r }: { r: Row }) {
  const m = r.meeting;
  const act = useAction();
  const [minutes, setMinutes] = useState(m.minutes?.text ?? '');
  const [states, setStates] = useState<Record<string, 'present' | 'apology' | 'absent'>>(() =>
    Object.fromEntries(r.invited.map((p) => [p.userId, p.answer === 'no' ? 'apology' : 'present'])),
  );
  const [guests, setGuests] = useState(m.attendees.join(', '));
  return (
    <section className="ld-detail-sec">
      <h3>{m.minutes ? 'Correct the minutes' : 'Add the minutes'}</h3>
      {r.invited.length > 0 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Who was there</legend>
          <ul className="ld-actionlist">
            {r.invited.map((p) => (
              <li key={p.userId} className="ld-action-item">
                <span className="ld-row-main">
                  <Person name={p.name} size={22} />
                </span>
                <span className="ld-row-aside">
                  {(['present', 'apology', 'absent'] as const).map((st) => (
                    <label key={st} className="small">
                      <input
                        type="radio"
                        name={`att-${p.userId}`}
                        checked={states[p.userId] === st}
                        onChange={() => setStates({ ...states, [p.userId]: st })}
                      />{' '}
                      {st === 'present' ? 'Present' : st === 'apology' ? 'Apology' : 'Absent'}
                    </label>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label className="field">
        <span className="label">Guests present (names, separated by commas)</span>
        <input className="input" aria-label="Guests present" value={guests} onChange={(e) => setGuests(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Minutes</span>
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
        A draft summary and the action items are made from the "Action:" lines. Owners who are invited staff are linked so they can mark their items done. The
        Director Office checks the summary.
      </p>
      <ErrorNotice error={act.error} />
      <div>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || minutes.trim().length < 20}
          onClick={() =>
            act.run(
              () =>
                api.addMinutes(m.id, minutes, [
                  ...r.invited.map((p) => ({ userId: p.userId, state: states[p.userId] ?? 'present' })),
                  ...guests
                    .split(',')
                    .map((g) => g.trim())
                    .filter(Boolean)
                    .map((name) => ({ userId: null, name, state: 'present' as const })),
                ]),
              'Minutes saved.',
            )
          }
        >
          Save minutes
        </button>
      </div>
    </section>
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

/** Pick invited staff by name; the list holds names and job titles only. */
function InvitePicker({ people, value, onChange }: { people: StaffPick[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = people
    .filter((p) => value.includes(p.id) || (q.trim().length >= 2 && `${p.name} ${p.title}`.toLowerCase().includes(q.trim().toLowerCase())))
    // Those already chosen first, so the organiser sees them without scrolling.
    .sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)))
    .slice(0, 30);
  return (
    <div className="field">
      <span className="label">Invite staff ({value.length} chosen)</span>
      <input className="input" aria-label="Search staff to invite" placeholder="Type a name or job to search" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="ld-checklist" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {shown.map((p) => (
          <li key={p.id}>
            <label className="ld-check">
              <input
                type="checkbox"
                checked={value.includes(p.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))}
              />
              <span className="ld-check-text">
                <span>{p.name}</span>
                <span className="muted small">{p.title}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted small">Type at least two letters to find staff.</p>}
    </div>
  );
}

/** Set a new meeting, or change a coming one (with the reason). */
function MeetingForm({ doa, people, draft, edit, onClose }: { doa: boolean; people: StaffPick[]; draft?: Draft; edit?: Row; onClose: () => void }) {
  const { companyId, company, me } = useApp();
  const m = edit?.meeting;
  const isCompanyUser = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  const [forCompany, setForCompany] = useState(draft?.group ? false : isCompanyUser);
  // A Director Office meeting may be for any company the person can see, not only the one open now.
  const [target, setTarget] = useState(companyId);
  const [title, setTitle] = useState(m?.title ?? draft?.title ?? '');
  const [kind, setKind] = useState<keyof typeof MEETING_KIND>(m?.kind ?? draft?.kind ?? 'management');
  const startLocal = (t: string) => new Date(Date.parse(t) + 8 * 3_600_000).toISOString();
  const [date, setDate] = useState(m ? startLocal(m.start).slice(0, 10) : new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10));
  const [from, setFrom] = useState(m ? startLocal(m.start).slice(11, 16) : '10:00');
  const [to, setTo] = useState(m ? startLocal(m.end).slice(11, 16) : '11:00');
  const [location, setLocation] = useState(m?.location ?? '');
  const [invite, setInvite] = useState<string[]>(m?.attendeeIds ?? draft?.invite ?? []);
  const [guests, setGuests] = useState(m?.attendees.join(', ') ?? '');
  const [agenda, setAgenda] = useState(m?.agenda ?? draft?.agenda ?? '');
  const [reason, setReason] = useState('');
  const [repeat, setRepeat] = useState<keyof typeof REPEAT>('');
  const [times, setTimes] = useState('');
  const act = useAction();
  const section = !!draft?.sectionKey || !!draft?.seriesKey;
  const guestList = guests
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const save = async () => {
    if (m) {
      return act.run(
        () =>
          api.changeMeeting(m.id, {
            title,
            start: myt(date, from),
            end: myt(date, to),
            location,
            agenda,
            attendeeIds: invite,
            attendees: guestList,
            reason,
          }),
        'Meeting changed.',
      );
    }
    return act.run(
      () =>
        api.scheduleMeeting({
          companyId: draft?.seriesKey ? (draft.companyId ?? null) : forCompany ? (doa ? target || companyId : companyId) : null,
          kind,
          title,
          start: myt(date, from),
          end: myt(date, to),
          location,
          attendees: guestList,
          agenda,
          attendeeIds: invite,
          repeat: repeat || null,
          ...(repeat && times ? { times: Number(times) } : {}),
          sectionKey: draft?.sectionKey ?? null,
          seriesKey: draft?.seriesKey ?? null,
        }),
      'Meeting set. Invited staff see it on their home screen.',
    );
  };
  return (
    <Drawer
      title={m ? `Change: ${m.title}` : draft?.seriesKey ? 'Set a regular meeting' : section ? "Set this month's operations meeting" : 'New meeting'}
      onClose={onClose}
    >
      <div className="ld-editor">
        {doa && !m && !section && (
          <label className="field">
            <span className="label">For</span>
            <Select
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
            </Select>
          </label>
        )}
        <label className="field">
          <span className="label">Title</span>
          <input className="input" aria-label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Kind</span>
          <Select
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
          </Select>
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
            <Select className="select" aria-label="Repeats" value={repeat} onChange={(e) => setRepeat(e.target.value as keyof typeof REPEAT)}>
              {Object.entries(REPEAT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
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
        <InvitePicker people={people} value={invite} onChange={setInvite} />
        <label className="field">
          <span className="label">Guests without a Prima account</span>
          <input className="input" aria-label="Guests" value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Names, separated by commas" />
        </label>
        <label className="field">
          <span className="label">Agenda, one item per line</span>
          <textarea
            className="textarea"
            rows={section ? 7 : 4}
            aria-label="Agenda"
            placeholder={'1. Actions from the last meeting\n2. …'}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
        </label>
        {m ? (
          <label className="field">
            <span className="label">Reason for the change</span>
            <input className="input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        ) : (
          <p className="muted small">A pre-briefing checklist for this kind of meeting is added when you save. Tick it off before the meeting.</p>
        )}
        {m && <p className="muted small">A new date or time clears the answers already given, so invited staff answer again.</p>}
        <ErrorNotice error={act.error} />
        <div className="ld-sticky ld-actions">
          <button className="btn" onClick={onClose}>
            Back
          </button>
          <button
            className="btn btn-primary"
            disabled={act.busy || !title.trim() || !agenda.trim() || (!!m && reason.trim().length < 5)}
            onClick={async () => {
              const r = await save();
              if (r) onClose();
            }}
          >
            {m ? 'Save the change' : 'Save meeting'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
