import { useState } from 'react';
import {
  CalendarBlankIcon,
  CaretRightIcon,
  ChartLineUpIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  HourglassIcon,
  ListChecksIcon,
  MapPinIcon,
  PlusIcon,
  UserIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { hasOwnStaffRecord, isGroupLeader, type ScoreState } from '@prima/core';
import { api, type BranchWork, type MyWork, type PersonWork, type TeamWork, type WorkRebalance, type WorkSummary } from '../api';
import { useApp } from '../App';
import { Card, PageHead, Person, Search, Stat, Stats } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, hhmm, useAction, useLoad, type Tone } from '../ui';
import { EvidenceCamera } from './Camera';
import { CooNoticesPanel } from './CooNotices';
import { Readiness } from './Remote';
import { CentralAdminGuide } from './CentralAdminGuide';
import { MyCash } from './FinanceCash';
import '../styles/selfservice.css';

type Task = MyWork['open'][number];

const STATE: Record<Task['state'], { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'crit' },
  returned: { label: 'Returned to fix', tone: 'warn' },
  waiting_review: { label: 'Waiting for review', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'ok' },
};
const SOURCE: Record<Task['source'], string> = { playbook: 'Playbook', assigned: 'From manager', meeting: 'From a meeting', own: 'Own task', ceo: 'CEO instruction' };
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
const has = (needle: string, ...xs: (string | null | undefined)[]) => !needle || xs.some((x) => x?.toLowerCase().includes(needle));

type WorkTab = 'mine' | 'team' | 'rebalance' | 'summary';

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
  // Managers open on their team's queue first; staff on their own work.
  const tabs: { key: WorkTab; label: string; count?: number }[] = [
    ...(hasTeam ? [{ key: 'team' as const, label: 'My team', count: team.data!.people.length }] : []),
    ...(own ? [{ key: 'mine' as const, label: 'My work' }] : []),
    ...(hasTeam ? [{ key: 'rebalance' as const, label: 'Rebalance' }] : []),
    ...(leader ? [{ key: 'summary' as const, label: 'Monday summary' }] : []),
  ];
  const [tab, setTab] = useState<WorkTab | null>(null);
  // P78: group leadership gives a task to anyone on staff, not only to its direct reports.
  const [giving, setGiving] = useState(false);
  const staff = team.data?.staff ?? [];
  const settled = !!team.data || !!team.error;
  const cur: WorkTab | null = tab ?? (settled ? (tabs[0]?.key ?? 'mine') : null);
  return (
    <div className="page ss">
      <PageHead
        title="Work"
        sub={
          hasTeam
            ? 'Your team’s exceptions, help requests and reviews first, then your own tasks. Tasks are also kept in Microsoft Planner.'
            : 'What to do today, what done means for each task, and help when you are stuck. Tasks are also kept in Microsoft Planner.'
        }
        actions={
          leader &&
          staff.length > 0 && (
            <button className="btn btn-primary" onClick={() => setGiving(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              Give a task
            </button>
          )
        }
      />
      {giving && <GiveTaskDrawer staff={staff} onClose={() => setGiving(false)} />}
      <CentralAdminGuide view="work" />
      {tabs.length > 1 && (
        <div className="tabbar ss-tabs" role="tablist" aria-label="Work sections">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={cur === t.key} onClick={() => setTab(t.key)}>
              {t.label}
              {t.count !== undefined && <span className="ss-count">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
      {cur === null && <Loading what="your work" />}
      {cur === 'mine' && own && <MyWorkTab />}
      {cur === 'team' && team.data && <TeamTab data={team.data} />}
      {cur === 'rebalance' && hasTeam && <RebalanceTab />}
      {cur === 'summary' && leader && <SummaryTab />}
      {!own && !leader && !hasTeam && team.data && <div className="empty">No work screen for this sign-in.</div>}
    </div>
  );
}

// ---------- My work ----------

type TaskFilter = 'all' | 'overdue' | 'returned' | 'open';

function MyWorkTab() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.myWork(), []);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [q, setQ] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your work" />;
  const overdue = data.open.filter((t) => t.state === 'overdue').length;
  const returned = data.open.filter((t) => t.state === 'returned').length;
  const needle = q.trim().toLowerCase();
  const shown = data.open
    .filter((t) => filter === 'all' || t.state === filter)
    .filter((t) => has(needle, t.title, t.doneMeans, t.assignedBy, SOURCE[t.source]));
  const onTime = data.measures.onTimePct;
  return (
    <>
      <Stats>
        <Stat label="Open tasks" value={data.open.length} icon={<ListChecksIcon size={16} />} tone="info" />
        <Stat label="Overdue" value={overdue} tone={overdue ? 'crit' : 'ok'} icon={<WarningIcon size={16} />} onClick={overdue ? () => setFilter('overdue') : undefined} />
        <Stat label="Waiting for review" value={data.waitingReview.length} icon={<HourglassIcon size={16} />} />
        <Stat
          label="On time, last 4 weeks"
          value={onTime === null ? 'UNKNOWN' : `${onTime}%`}
          note={`Standard ${data.measures.standardPct}%`}
          tone={data.measures.atStandard === null ? 'unknown' : data.measures.atStandard ? 'ok' : 'warn'}
          icon={<ChartLineUpIcon size={16} />}
        />
      </Stats>

      <Card
        title={data.playbook.title}
        sub={
          <>
            Your manager: {data.manager ? `${data.manager.name}, ${data.manager.title}` : 'none'}
            {data.managerAssumed ? ' (assumed: HR to confirm the reporting line)' : ''}
          </>
        }
        actions={
          <>
            {data.playbook.items.length > 0 && (
              <Chip tone={data.signoff ? 'ok' : 'warn'}>{data.signoff ? `Playbook signed off by ${data.signoff.by}` : 'Playbook not signed off yet'}</Chip>
            )}
            <Chip tone="info" title="Tasks are kept in both Prima and Microsoft Planner; a newer change in Planner wins.">
              Also in Microsoft Planner{data.planner.mode === 'mock' ? ' (test connection)' : ''}
            </Chip>
          </>
        }
      >
        <CheckInForm data={data} />
      </Card>

      <CooNoticesPanel notices={data.cooNotices} />

      <div className="ss-cols">
        <div className="ss-stack">
          <Card title="To do" sub={`${data.open.length} open${overdue ? `, ${overdue} overdue` : ''}`} flush>
            {data.open.length > 0 && (
              <div className="ss-tools">
                <div className="seg" role="group" aria-label="Which tasks">
                  {(
                    [
                      ['all', 'All', data.open.length],
                      ['overdue', 'Overdue', overdue],
                      ['returned', 'Returned', returned],
                      ['open', 'Open', data.open.filter((t) => t.state === 'open').length],
                    ] as [TaskFilter, string, number][]
                  ).map(([k, l, n]) => (
                    <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {l}
                      <span className="ss-count">{n}</span>
                    </button>
                  ))}
                </div>
                <Search value={q} onChange={setQ} placeholder="Search tasks" />
              </div>
            )}
            <ul className="ss-rows">
              {data.open.length === 0 && <li className="empty">Nothing open.</li>}
              {data.open.length > 0 && shown.length === 0 && <li className="empty">No task matches.</li>}
              {shown.map((t) => (
                <li key={t.id}>
                  <MyTaskRow t={t} />
                </li>
              ))}
            </ul>
            <div className="ss-foot">
              <OwnTaskForm userId={me.user.id} />
            </div>
          </Card>

          {data.waitingReview.length > 0 && (
            <Card title="Waiting for your manager’s review" flush>
              <ul className="ss-rows">
                {data.waitingReview.map((t) => (
                  <li key={t.id} className="ss-row">
                    <div className="ss-row-main">
                      <span className="ss-row-title">{t.title}</span>
                      <span className="ss-meta">
                        Finished {dateTimeLabel(t.evidence!.at)}: {t.evidence!.note}
                        {t.evidence!.ref ? ` (${t.evidence!.ref})` : ''}
                      </span>
                    </div>
                    <Chip tone={t.onTime ? 'ok' : 'warn'}>{t.onTime ? 'on time' : 'late'}</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Results m={data.measures} />
          <Playbook items={data.playbook.items} />
        </div>

        <div className="ss-stack">
          <HelpPanel data={data} />
          <MyCash />
          <Card title="Working from home" sub="Opens after the 3-month probation, with the playbook signed off and results at standard.">
            <Readiness r={data.readiness} />
          </Card>
          {(me.user.itRole === 'manager' || me.user.itRole === 'lead') && <PlannerSync />}
        </div>
      </div>
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
    <div className="ss-form">
      <h3 className="ss-form-title">Morning check-in (by {data.checkInBy})</h3>
      <div className="ss-grid">
        <div className="field">
          <span className="label">Where you work today</span>
          <div className="seg" role="group" aria-label="Where you work today">
            {(['office', 'home', 'branch', 'field'] as const).map((w) => (
              <button key={w} aria-pressed={where === w} onClick={() => setWhere(w)}>
                {w === 'office' ? 'Office' : w === 'home' ? 'Home' : w === 'branch' ? 'Branch' : 'Field'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">Hours today</span>
          <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours today" />
        </label>
      </div>
      <div className="ss-grid-3">
        {p.map((v, i) => (
          <label key={i} className="field">
            <span className="label">Priority {i + 1}</span>
            <input
              className="input"
              placeholder={`Priority ${i + 1}`}
              aria-label={`Priority ${i + 1}`}
              value={v}
              onChange={(e) => setP((x) => x.map((y, k) => (k === i ? e.target.value : y)))}
            />
          </label>
        ))}
      </div>
      <label className="field">
        <span className="label">Support you need today (optional)</span>
        <input
          className="input"
          placeholder="Support you need today (optional)"
          aria-label="Support needed"
          value={support}
          onChange={(e) => setSupport(e.target.value)}
        />
      </label>
      <ErrorNotice error={act.error} />
      <div className="ss-form-foot">
        <span className="ss-note">{data.homeToday ? 'Today is a home day: your priorities become your day plan once you are signed in.' : ''}</span>
        <button
          className="btn btn-primary"
          disabled={act.busy || !p.some((x) => x.trim())}
          onClick={() => act.run(() => api.workCheckIn({ where, hours, priorities: p.filter((x) => x.trim()), support }), 'Checked in.')}
        >
          Send check-in
        </button>
      </div>
    </div>
  );
}

function TaskHead({ t }: { t: Task }) {
  const st = STATE[t.state];
  return (
    <>
      <div className="ss-task-top">
        <div className="ss-task-title">{t.title}</div>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      <div className="ss-meta">
        <span>
          <CalendarBlankIcon size={14} aria-hidden="true" />
          Due {due(t)}
        </span>
        <span>
          <UserIcon size={14} aria-hidden="true" />
          {SOURCE[t.source]}
          {t.assignedBy ? ` (${t.assignedBy})` : ''}
        </span>
        {t.priority === 'high' && <span className="ss-high">High priority</span>}
        {t.late && <span>More time given: {t.late.reason}</span>}
      </div>
    </>
  );
}

function DoneMeans({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="ss-done">
      <span className="ss-done-label">Done means:</span>
      {text}
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
    <article className="ss-task" data-tone={st.tone}>
      <TaskHead t={t} />
      <DoneMeans text={t.doneMeans} />
      <LastChange t={t} />
      {t.review?.verdict === 'returned' && (
        <div className="notice small" data-tone="warn">
          {t.review.by}: {t.review.note}
        </div>
      )}
      {mode === null && (
        <div className="ss-actions">
          <button className="btn btn-sm btn-primary" onClick={() => setMode('done')}>
            Finish with proof
          </button>
          {!t.late && t.state !== 'overdue' && (
            <button className="btn btn-sm" onClick={() => setMode('time')}>
              Ask for more time
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => setMode('help')}>
            Stuck? Ask for help
          </button>
        </div>
      )}
      {mode !== null && (
        <div className="ss-sub-form">
          {mode === 'done' && (
            <>
              <label className="field">
                <span className="label">Proof</span>
                <input
                  className="input"
                  placeholder="What came out of it, so your manager can check it"
                  aria-label="Proof"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Reference</span>
                <input
                  className="input"
                  placeholder="Record number or file name (optional)"
                  aria-label="Reference"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                />
              </label>
            </>
          )}
          {mode === 'time' && (
            <div className="ss-grid">
              <label className="field">
                <span className="label">Reason</span>
                <input className="input" placeholder="Why you need more time" aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">New due time</span>
                <input className="input" type="datetime-local" aria-label="New due time" value={when} onChange={(e) => setWhen(e.target.value)} />
              </label>
            </div>
          )}
          {mode === 'help' && (
            <label className="field">
              <span className="label">What you are stuck on</span>
              <textarea
                className="textarea"
                rows={2}
                placeholder="What you are stuck on"
                aria-label="Help needed"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <ErrorNotice error={act.error} />
          <div className="ss-actions">
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
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === null && <ErrorNotice error={act.error} />}
    </article>
  );
}

function OwnTaskForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(localIn(1));
  const act = useAction();
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Add my own task
      </button>
    );
  return (
    <div className="ss-form">
      <div className="ss-grid">
        <label className="field">
          <span className="label">Task</span>
          <input className="input" placeholder="Task" aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="datetime-local" aria-label="Due" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="ss-actions">
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
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
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
    <Card title="Stuck, need help" sub={`Goes to ${data.manager?.name ?? 'your manager'}. Not answered in 30 minutes, it shows to their manager too.`} flush>
      <div className="ss-pad ss-form">
        <div className="ss-inline">
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
      </div>
      {data.help.length > 0 && (
        <ul className="ss-rows ss-rows-top">
          {data.help.map((h) => (
            <li key={h.id} className="ss-row">
              <div className="ss-row-main">
                <span className="ss-meta">{dateTimeLabel(h.at)}</span>
                <span>{h.text}</span>
                {h.answer && (
                  <span className="small">
                    <strong>{h.answer.by}:</strong> {h.answer.text}
                  </span>
                )}
              </div>
              {h.answer ? (
                <Chip tone="ok">Answered</Chip>
              ) : (
                <Chip tone={h.escalated ? 'warn' : 'info'}>{h.escalated ? `Waiting; now also with ${h.escalatedTo}` : `Waiting for ${h.managerName}`}</Chip>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Results({ m }: { m: MyWork['measures'] }) {
  return (
    <Card
      title="Results, last 4 weeks"
      actions={
        <Chip tone={m.atStandard === null ? 'neutral' : m.atStandard ? 'ok' : 'warn'}>
          {m.atStandard === null ? 'UNKNOWN: no tasks due yet' : m.atStandard ? 'At standard' : 'Below standard'}
        </Chip>
      }
      flush
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th className="num">Tasks due</th>
              <th className="num">On time</th>
              <th className="num">Returned</th>
              {m.measures.map((x) => (
                <th key={x.id} className="num">
                  {x.label} (standard {x.perWeek}/week)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.weeks.map((w) => (
              <tr key={w.week}>
                <td>{dateLabel(w.week)}</td>
                <td className="num">{w.due}</td>
                <td className="num">{w.onTimePct === null ? 'UNKNOWN' : `${w.onTimePct}%`}</td>
                <td className="num">{w.returned}</td>
                {w.measures.map((x) => (
                  <td key={x.id} className="num">
                    {x.count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ss-note ss-foot">
        Counted from Prima’s own records: tasks finished by their due time, and the work recorded for each measure. The standard is {m.standardPct}% on time and
        each measure at its weekly standard (proposed, for approval). This week is still running.
      </p>
    </Card>
  );
}

function Playbook({ items }: { items: MyWork['playbook']['items'] }) {
  if (items.length === 0) return <div className="notice small">No playbook for this role yet: your manager writes it with HR.</div>;
  return (
    <Card title="My playbook" sub={`${items.length} recurring task${items.length === 1 ? '' : 's'}`} flush>
      <ul className="ss-rows">
        {items.map((i) => (
          <li key={i.id} className="ss-task">
            <div className="ss-task-top">
              <div className="ss-task-title">{i.text}</div>
              <Chip tone="neutral">
                {EVERY[i.every]}
                {i.every === 'daily' ? `, by ${i.due}` : i.every === 'weekly' ? `, by ${WEEKDAY[Number(i.due)]} 17:00` : `, by the ${i.due}th`}
              </Chip>
            </div>
            <DoneMeans text={i.doneMeans} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlannerSync() {
  const act = useAction();
  return (
    <Card
      title="Microsoft Planner"
      actions={
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
      }
    >
      <div className="ss-form">
        <p className="ss-note">
          Tasks are kept in both Prima and Planner, Planner preferred. New and changed tasks wait here until they are sent; at go-live this runs on a timer once
          Entra sign-in is approved. Until then the connection is a test one.
        </p>
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

// ---------- My team ----------

type Row = TeamWork['people'][number];

const needsLook = (p: Row) =>
  p.overdue > 0 || p.returned > 0 || p.waitingReview > 0 || p.openHelp > 0 || p.talk.length > 0 || p.checkInState === 'late' || p.checkInState === 'missing';

function TeamTab({ data }: { data: TeamWork }) {
  const [open, setOpen] = useState<Row | null>(null);
  const [filter, setFilter] = useState<'look' | 'all'>('all');
  const [q, setQ] = useState('');
  const sum = (f: (p: Row) => number) => data.people.reduce((n, p) => n + f(p), 0);
  const needle = q.trim().toLowerCase();
  const look = data.people.filter(needsLook).length;
  const shown = data.people.filter((p) => filter === 'all' || needsLook(p)).filter((p) => has(needle, p.name, p.title));
  return (
    <>
      <Stats>
        <Stat label="People" value={data.people.length} icon={<UsersThreeIcon size={16} />} />
        <Stat label="Overdue tasks" value={sum((p) => p.overdue)} tone={sum((p) => p.overdue) ? 'crit' : 'ok'} icon={<WarningIcon size={16} />} />
        <Stat label="To review" value={sum((p) => p.waitingReview)} tone={sum((p) => p.waitingReview) ? 'info' : 'ok'} icon={<CheckCircleIcon size={16} />} />
        <Stat label="Help waiting" value={data.help.length} tone={data.help.length ? 'warn' : 'ok'} icon={<ChatCircleDotsIcon size={16} />} />
        <Stat label="One-to-one due" value={data.people.filter((p) => p.oneOnOneDue).length} icon={<CalendarBlankIcon size={16} />} />
        <Stat
          label="Talk to"
          value={data.people.filter((p) => p.talk.length).length}
          tone={data.people.some((p) => p.talk.length) ? 'warn' : 'ok'}
          icon={<UserIcon size={16} />}
        />
      </Stats>
      {data.help.length > 0 && (
        <Card title="Help waiting" actions={<Chip tone="warn">{data.help.length} waiting</Chip>} flush>
          <ul className="ss-rows">
            {data.help.map((h) => (
              <li key={h.id}>
                <HelpAnswerRow h={h} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Your team today"
        sub={
          <>
            Exceptions first. Check-in due by {data.rules.checkInBy}; a one-to-one every {data.rules.oneOnOneDays} days; due soon means within{' '}
            {data.rules.dueSoonDays} days. “Talk to” is a prompt for you, never a finding.
          </>
        }
        flush
      >
        <div className="ss-tools">
          <div className="seg" role="group" aria-label="Who to show">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              Everyone
              <span className="ss-count">{data.people.length}</span>
            </button>
            <button aria-pressed={filter === 'look'} onClick={() => setFilter('look')}>
              Needs a look
              <span className="ss-count">{look}</span>
            </button>
          </div>
          <Search value={q} onChange={setQ} placeholder="Search name or title" />
        </div>
        <ul className="ss-rows">
          {shown.length === 0 && <li className="empty">Nobody here.</li>}
          {shown.map((p) => (
            <li key={p.userId}>
              <button
                className="ss-row ss-person"
                data-tone={p.overdue > 0 ? 'crit' : p.talk.length || p.openHelp || p.returned ? 'warn' : undefined}
                onClick={() => setOpen(p)}
              >
                <span className="ss-row-main">
                  <Person
                    name={p.name}
                    sub={
                      <>
                        {p.title}
                        {p.where === 'home' ? ' · working from home' : ''}
                        {p.signedIn ? ` · signed in ${hhmm(p.signedIn.in)}` : ''}
                      </>
                    }
                  />
                  <span className="ss-chips">
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
                  </span>
                  {p.talk.length > 0 && <span className="ss-talk">Talk to them: {p.talk.join('; ')}</span>}
                </span>
                <CaretRightIcon size={18} className="ss-chev" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {open && <PersonDrawer userId={open.userId} name={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}

function HelpAnswerRow({ h }: { h: TeamWork['help'][number] }) {
  const [text, setText] = useState('');
  const act = useAction();
  return (
    <div className="ss-task" data-tone={h.escalated ? 'warn' : undefined}>
      <div className="ss-task-top">
        <Person name={h.userName} sub={dateTimeLabel(h.at)} size={32} />
        {h.escalated && <Chip tone="warn">Not answered in 30 minutes{h.managerName ? ` by ${h.managerName}` : ''}</Chip>}
      </div>
      <div>{h.text}</div>
      <div className="ss-inline">
        <input className="input" placeholder="Answer or next step" aria-label="Answer" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-sm btn-primary" disabled={act.busy || text.trim().length < 5} onClick={() => act.run(() => api.helpAnswer(h.id, text), 'Answered.')}>
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
    <>
      <section className="ss-sec">
        <Readiness r={p.readiness} />
        {!p.signedOff && p.playbookItems.length > 0 && (
          <div className="ss-actions">
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.playbookSignOff(p.userId), 'Playbook signed off.')}>
              Sign off: they know the {p.playbook} playbook
            </button>
          </div>
        )}
        <ErrorNotice error={act.error} />
      </section>
      <section className="ss-sec">
        <h3 className="ss-sec-title">Tasks</h3>
        {p.cooCheck === 'reason' && (
          <p className="ss-note">
            You are checking in place of their line manager: give the reason (a short one is fine). Their line manager, and whoever gave the task, are told.
          </p>
        )}
        {p.cooCheck === 'own' && <p className="ss-note">Every approval has a reason: a short one is fine.</p>}
        {p.cooCheck === 'not_monitored' && <p className="ss-note">The COO checks work only in the departments he directly monitors. Their line manager checks this.</p>}
        <div className="ss-boxed">
          <ul className="ss-rows">
            {p.tasks.length === 0 && <li className="empty">Nothing open.</li>}
            {p.tasks.map((t) => (
              <li key={t.id}>
                <ReviewTaskRow t={t} cooCheck={p.cooCheck} />
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="ss-sec">
        <AssignForm userId={p.userId} />
      </section>
      <section className="ss-sec">
        <OneOnOneForm userId={p.userId} last={p.oneOnOnes[0] ?? null} />
      </section>
      <section className="ss-sec">
        <Results m={p.measures} />
      </section>
    </>
  );
}

function ReviewTaskRow({ t, cooCheck }: { t: Task; cooCheck: PersonWork['cooCheck'] }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const st = STATE[t.state];
  return (
    <article className="ss-task" data-tone={st.tone}>
      <TaskHead t={t} />
      <DoneMeans text={t.doneMeans} />
      {t.evidence && (
        <div className="small">
          <strong>Proof:</strong> {t.evidence.note}
          {t.evidence.ref ? ` (${t.evidence.ref})` : ''} · {t.onTime ? 'on time' : 'late'}
        </div>
      )}
      <LastChange t={t} />
      {(t.state === 'open' || t.state === 'overdue' || t.state === 'returned') && <MoveOrAdjust t={t} />}
      {t.state === 'waiting_review' && cooCheck !== 'not_monitored' && (
        <div className="ss-sub-form">
          <input
            className="input"
            placeholder={cooCheck === 'reason' || cooCheck === 'own' ? 'Reason (needed to accept or return it)' : 'Note (needed to return it)'}
            aria-label="Review note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="ss-actions">
            <button
              className="btn btn-sm btn-primary"
              disabled={act.busy || ((cooCheck === 'reason' || cooCheck === 'own') && !note.trim())}
              onClick={() => act.run(() => api.workTaskReview(t.id, true, note), 'Accepted.')}
            >
              Accept
            </button>
            <button className="btn btn-sm" disabled={act.busy || note.trim().length < 10} onClick={() => act.run(() => api.workTaskReview(t.id, false, note), 'Returned to fix.')}>
              Return to fix
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </article>
  );
}

/** The manager's last move or readjust of a task, with the reason (Fauzan, 2 Nov 2026). */
function LastChange({ t }: { t: Task }) {
  const c = t.changes?.[t.changes.length - 1];
  if (!c) return null;
  const when = `${dateLabel(c.at.slice(0, 10))} ${hhmm(c.at)}`;
  return (
    <div className="notice small" data-tone="info">
      {c.kind === 'reassign' ? `${c.by} moved this from ${c.fromName} to ${c.toName}` : `${c.by} changed the ${c.dueTo !== c.dueFrom ? 'due time' : 'priority'}`} ({when}): {c.reason}
    </div>
  );
}

/** Delegate (move to someone else in your line) or readjust (new due time or priority), always with a reason. */
function MoveOrAdjust({
  t,
  preset,
  onDone,
}: {
  t: { id: string; title: string; version: string; userId?: string; priority?: 'high' | 'normal' };
  preset?: { action: 'reassign' | 'adjust'; toUserId: string | null; newDueAt: string | null; adviceId: string };
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(!!preset);
  const [mode, setMode] = useState<'reassign' | 'adjust'>(preset?.action ?? 'reassign');
  const [to, setTo] = useState(preset?.toUserId ?? '');
  const toLocal = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 16);
  const [when, setWhen] = useState(preset?.newDueAt ? toLocal(preset.newDueAt) : '');
  const [priority, setPriority] = useState<'' | 'high' | 'normal'>('');
  const [reason, setReason] = useState('');
  const team = useLoad(() => (open ? api.workRebalance() : Promise.resolve(null)), [open]);
  const act = useAction();
  if (!open)
    return (
      <div className="ss-actions">
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Move or readjust
        </button>
      </div>
    );
  const people = (team.data?.people ?? []).filter((p) => p.userId !== t.userId);
  const submit = () =>
    act
      .run(
        () =>
          mode === 'reassign'
            ? api.workTaskReassign(t.id, { toUserId: to, reason, dueAt: when ? fromLocal(when) : null, adviceId: preset?.adviceId ?? null, expectedVersion: t.version })
            : api.workTaskAdjust(t.id, {
                dueAt: when ? fromLocal(when) : null,
                priority: priority || null,
                reason,
                adviceId: preset?.adviceId ?? null,
                expectedVersion: t.version,
              }),
        mode === 'reassign' ? 'Task moved.' : 'Task readjusted.',
      )
      .then((r) => {
        if (r !== undefined) onDone?.();
      });
  return (
    <div className="ss-sub-form">
      <div className="seg" role="group" aria-label="Move or readjust">
        <button aria-pressed={mode === 'reassign'} onClick={() => setMode('reassign')}>
          Move to someone else
        </button>
        <button aria-pressed={mode === 'adjust'} onClick={() => setMode('adjust')}>
          Readjust
        </button>
      </div>
      <div className="ss-grid">
        {mode === 'reassign' && (
          <label className="field">
            <span className="label">Move to</span>
            <select className="input" aria-label="Move to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose who takes it</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name} · {p.openTasks} open{p.overdue ? `, ${p.overdue} overdue` : ''}
                  {p.awaySoon ? ` · leave ${p.awaySoon.from}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="label">{mode === 'reassign' ? 'New due time (needed if it is already overdue)' : 'New due time'}</span>
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {mode === 'adjust' && (
          <label className="field">
            <span className="label">Priority</span>
            <select className="input" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as '' | 'high' | 'normal')}>
              <option value="">Keep the priority{t.priority ? ` (${t.priority})` : ''}</option>
              <option value="high">High priority</option>
              <option value="normal">Normal priority</option>
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span className="label">Reason</span>
        <input className="input" placeholder="Reason (needed; a short one is fine)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="ss-actions">
        <button className="btn btn-sm btn-primary" disabled={act.busy || reason.trim().length < 5 || (mode === 'reassign' ? !to : !when && !priority)} onClick={submit}>
          {mode === 'reassign' ? 'Move it' : 'Save the change'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Rebalance advice (Fauzan, 2 Nov 2026) ----------

const ROOM: Record<WorkRebalance['people'][number]['room'], { label: string; tone: Tone }> = {
  room: { label: 'Has room', tone: 'ok' },
  busy: { label: 'Busy', tone: 'neutral' },
  overloaded: { label: 'Overloaded', tone: 'warn' },
  away: { label: 'On leave', tone: 'info' },
};
const KIND: Record<WorkRebalance['advice'][number]['kind'], string> = {
  cover_leave: 'Leave cover',
  overdue_stuck: 'Overdue, needs a decision',
  overloaded: 'Share the load',
  at_risk: 'Tight on time',
};

function RebalanceTab() {
  const { data, error } = useLoad(() => api.workRebalance(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the advice" />;
  // The AI button is gone from this screen, so its pointer in the server's wording goes too.
  const basis = data.basis.replace(/^Arisha[’']s advice/, 'Advice').replace(/; ask Arisha AI on a case when you need more\./, '.');
  return (
    <div className="ss-cols">
      <Card title="Suggested moves" sub={<>{basis} It is a prompt for you, never a finding about the person.</>} flush>
        <ul className="ss-rows">
          {data.advice.length === 0 && (
            <li className="empty">
              {data.coverage.people === 0
                ? 'Nobody in your line yet, so there is no advice.'
                : `No rule fired on the tasks Prima holds. This is not a finding that the work is fair or on time: ${data.coverage.unknownUsualTime} of ${data.coverage.people} people have too few finished tasks for a usual time (UNKNOWN), ${data.coverage.openWithoutActTiming} of ${data.coverage.openTasks} open tasks have no ACT timing, and work outside Prima is not counted.`}
            </li>
          )}
          {data.advice.map((a) => (
            <li key={a.id}>
              <AdviceRow a={a} />
            </li>
          ))}
        </ul>
      </Card>
      <Card
        title="Your team’s load"
        sub={
          <>
            Open tasks (high priority counts twice); team average {data.teamLoadAverage ?? 'UNKNOWN'}. Usual time is from getting a task to finishing it, over the
            last {data.rules.lookBackDays} days; under {data.rules.minFinished} finished tasks it is UNKNOWN.
          </>
        }
        flush
      >
        <ul className="ss-rows">
          {data.people.length === 0 && <li className="empty">Nobody reports to you.</li>}
          {data.people.map((p) => (
            <li key={p.userId} className="ss-row">
              <div className="ss-row-main">
                <Person name={p.name} sub={p.title} size={32} />
                <span className="ss-chips">
                  <Chip tone="neutral">{p.openTasks} open</Chip>
                  {p.overdue > 0 && <Chip tone="crit">{p.overdue} overdue</Chip>}
                  <Chip tone="neutral">{p.typicalHours === null ? 'Usual time UNKNOWN' : `Usually ${p.typicalHours} h per task`}</Chip>
                  {p.awaySoon && (
                    <Chip tone="info">
                      Leave {p.awaySoon.from}
                      {p.awaySoon.to !== p.awaySoon.from ? ` to ${p.awaySoon.to}` : ''}
                      {p.awaySoon.approved ? '' : ' (asked)'}
                    </Chip>
                  )}
                </span>
              </div>
              <Chip tone={ROOM[p.room].tone}>{ROOM[p.room].label}</Chip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AdviceRow({ a }: { a: WorkRebalance['advice'][number] }) {
  const [doing, setDoing] = useState(false);
  return (
    <article className="ss-task" data-tone={a.level === 'act_now' ? 'warn' : undefined}>
      <div className="ss-task-top">
        <div className="ss-task-title">{a.advice}</div>
        <Chip tone={a.level === 'act_now' ? 'warn' : 'neutral'}>{KIND[a.kind]}</Chip>
      </div>
      <ul className="ss-note ss-why">
        {a.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {doing ? (
        <MoveOrAdjust
          t={{ id: a.taskId, title: a.taskTitle, version: a.taskVersion, userId: a.userId }}
          preset={{ action: a.suggest.action, toUserId: a.suggest.toUserId, newDueAt: a.suggest.newDueAt, adviceId: a.id }}
          onDone={() => setDoing(false)}
        />
      ) : (
        <div className="ss-actions">
          <button className="btn btn-sm" onClick={() => setDoing(true)}>
            {a.suggest.action === 'reassign' ? 'Review and move' : 'Review and readjust'}
          </button>
        </div>
      )}
    </article>
  );
}

/** P78: give a task to anyone on staff (group leadership); the same form as from a person's own page. */
function GiveTaskDrawer({ staff, onClose }: { staff: TeamWork['staff']; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = staff.filter((s) => !needle || has(needle, s.name, s.title ?? '')).slice(0, 200);
  return (
    <Drawer title="Give a task" sub="They see it in My work and in Microsoft Planner. You review it when they mark it done." onClose={onClose}>
      <div className="ss-form">
        <Search value={q} onChange={setQ} placeholder="Search name or title" />
        <label className="field">
          <span className="label">Who</span>
          <select className="select" aria-label="Who" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {shown.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.title ? ` · ${s.title}` : ''}
              </option>
            ))}
          </select>
          {staff.length === 0 && <span className="help">Nobody on staff has a Prima sign-in yet.</span>}
        </label>
      </div>
      {userId && <AssignForm key={userId} userId={userId} />}
    </Drawer>
  );
}

function AssignForm({ userId }: { userId: string }) {
  const [title, setTitle] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [when, setWhen] = useState(localIn(2));
  const [high, setHigh] = useState(false);
  const act = useAction();
  return (
    <div className="ss-form">
      <h3 className="ss-sec-title">Give a task</h3>
      <label className="field">
        <span className="label">Task</span>
        <input className="input" placeholder="Task" aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Done means</span>
        <textarea
          className="textarea"
          rows={2}
          placeholder="What done looks like: the output you will check"
          aria-label="Done means"
          value={doneMeans}
          onChange={(e) => setDoneMeans(e.target.value)}
        />
      </label>
      <div className="ss-grid">
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="datetime-local" aria-label="Due" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="ss-check ss-check-end">
          <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} />
          High priority
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="ss-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy}
          onClick={async () => {
            const r = await act.run(() => api.workTaskAdd({ userId, title, doneMeans, dueAt: fromLocal(when), priority: high ? 'high' : 'normal' }), 'Task given.');
            if (r) {
              setTitle('');
              setDoneMeans('');
            }
          }}
        >
          Give task
        </button>
      </div>
    </div>
  );
}

function OneOnOneForm({ userId, last }: { userId: string; last: PersonWork['oneOnOnes'][number] | null }) {
  const [notes, setNotes] = useState('');
  const [agreed, setAgreed] = useState('');
  const act = useAction();
  return (
    <div className="ss-form">
      <h3 className="ss-sec-title">One-to-one</h3>
      <p className="ss-note">{last ? `Last on ${dateLabel(last.date)} with ${last.managerName}: ${last.notes}` : 'No one-to-one recorded yet.'}</p>
      <label className="field">
        <span className="label">Notes</span>
        <textarea className="textarea" rows={2} placeholder="What you talked about" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Agreed</span>
        <textarea className="textarea" rows={2} placeholder="What was agreed, one per line" aria-label="Agreed" value={agreed} onChange={(e) => setAgreed(e.target.value)} />
      </label>
      <ErrorNotice error={act.error} />
      <div className="ss-actions">
        <button
          className="btn btn-sm"
          disabled={act.busy}
          onClick={() => act.run(() => api.oneOnOneRecord({ userId, notes, agreed: agreed.split('\n') }), 'One-to-one recorded.')}
        >
          Record one-to-one
        </button>
      </div>
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
  const red = s.branches.filter((b) => b.overall === 'red').length;
  return (
    <>
      <p className="ss-lead">
        Last week (from {dateLabel(s.week)}). At go-live this is sent every Monday at 08:00 (next: {dateTimeLabel(s.sendsAt)}) to the CEO and group leadership.
      </p>
      <Stats>
        <Stat
          label="Help answered in 30 min"
          value={s.help.pct === null ? 'UNKNOWN' : `${s.help.pct}%`}
          tone={s.help.pct === null ? 'unknown' : undefined}
          note={`${s.help.answeredIn30} of ${s.help.asked}`}
          icon={<ChatCircleDotsIcon size={16} />}
        />
        <Stat label="Talk to" value={s.talk.length} tone={s.talk.length ? 'warn' : 'ok'} icon={<UserIcon size={16} />} />
        <Stat label="Branches red" value={red} tone={red ? 'crit' : 'ok'} icon={<MapPinIcon size={16} />} />
      </Stats>
      <Card title="By department" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th className="num">People</th>
                <th className="num">Tasks due</th>
                <th className="num">On time</th>
                <th className="num">Returned</th>
                <th className="num">Overdue now</th>
                <th className="num">One-to-one this week</th>
                <th className="num">Below standard</th>
                <th className="num">No playbook</th>
              </tr>
            </thead>
            <tbody>
              {s.departments.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td className="num">{d.people}</td>
                  <td className="num">{d.due}</td>
                  <td className="num">{d.onTimePct === null ? 'UNKNOWN' : `${d.onTimePct}%`}</td>
                  <td className="num">{d.returned}</td>
                  <td className="num">{d.overdue}</td>
                  <td className="num">{d.oneOnOnePct}%</td>
                  <td className="num">{d.belowStandard}</td>
                  <td className="num">{d.noPlaybook}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="ss-cols" data-even="">
        <Card title="Far branches" flush>
          <ul className="ss-rows">
            {s.branches.map((b) => (
              <li key={b.id} className="ss-row" data-tone={b.overall === 'red' ? 'crit' : b.overall === 'amber' ? 'warn' : undefined}>
                <div className="ss-row-main">
                  <span className="ss-row-title">{b.name}</span>
                  <span className="ss-meta">
                    {b.red} red, {b.unknown} unknown of 8 measures
                  </span>
                </div>
                <Chip tone={SCORE[b.overall].tone}>{SCORE[b.overall].label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
        {s.talk.length > 0 && (
          <Card title="Managers asked to talk to" flush>
            <ul className="ss-rows">
              {s.talk.map((t) => (
                <li key={t.userId} className="ss-row">
                  <div className="ss-row-main">
                    <Person name={t.name} sub={t.title} size={32} />
                    <span className="ss-talk">{t.reasons.join('; ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <PlannerSync />
    </>
  );
}

// ---------- Far branches ----------

type BranchRow = BranchWork['branches'][number];
const KIND_LABEL = { om: 'OM visit', rom: 'Regional OM visit', act: 'ACT unannounced audit', spot: 'Video spot check' } as const;
const SCORE_SHORT: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', om: 'OM', rom: 'ROM', act: 'ACT', spot: 'Spot' };

/**
 * Far branches (Fauzan, 27 Oct 2026): checklists with photo proof, an 8-measure scorecard where UNKNOWN is never green,
 * OM twice a month, Regional OM monthly, ACT unannounced once a half year, and up to 2 random video spot checks a month.
 */
export function BranchWorkView() {
  const { data, error } = useLoad(() => api.branchWork(), []);
  const [open, setOpen] = useState<string | null>(null);
  const head = (
    <PageHead
      title="Far branches"
      sub="Daily, weekly and monthly checklists with photo proof, OM and Regional OM visits, ACT audits and video spot checks, scored on 8 measures per branch."
    />
  );
  if (error)
    return (
      <div className="page ss">
        {head}
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        {head}
        <Loading what="branches" />
      </div>
    );
  const b = data.branches.find((x) => x.id === open) ?? null;
  const red = data.branches.filter((x) => x.overall === 'red').length;
  return (
    <div className="page ss">
      {head}
      <Stats>
        <Stat label="Branches" value={data.branches.length} icon={<MapPinIcon size={16} />} />
        <Stat label="Red" value={red} tone={red ? 'crit' : 'ok'} icon={<WarningIcon size={16} />} />
        <Stat
          label="Daily checklist sent today"
          value={`${data.branches.filter((x) => x.due.find((d) => d.kind === 'daily')?.done).length} of ${data.branches.length}`}
          icon={<ClipboardTextIcon size={16} />}
        />
      </Stats>
      <Card title="Branches" sub="Open a branch for its scorecard, checklists and visits." flush>
        <ul className="ss-rows">
          {data.branches.length === 0 && <li className="empty">No branches for this sign-in.</li>}
          {data.branches.map((x) => (
            <li key={x.id}>
              <button className="ss-row" data-tone={x.overall === 'red' ? 'crit' : x.overall === 'amber' ? 'warn' : undefined} onClick={() => setOpen(x.id)}>
                <span className="ss-row-main">
                  <span className="ss-row-title">{x.name}</span>
                  <span className="ss-meta">
                    {x.company} · {x.manager ? x.manager.name : 'no branch manager sign-in'}
                  </span>
                  <span className="ss-chips">
                    {x.score.map((s) => (
                      <Chip key={s.key} tone={SCORE[s.state].tone} title={`${s.label}: ${s.value}`}>
                        {SCORE_SHORT[s.key] ?? 'Tasks'}
                      </Chip>
                    ))}
                  </span>
                </span>
                <span className="ss-row-side">
                  <Chip tone={SCORE[x.overall].tone}>{SCORE[x.overall].label}</Chip>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="ss-note ss-foot">A measure with no data shows UNKNOWN, never green. Visit and spot-check limits are proposals for approval.</p>
      </Card>
      {b && <BranchDrawer b={b} checklists={data.checklists} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BranchDrawer({ b, checklists, onClose }: { b: BranchRow; checklists: BranchWork['checklists']; onClose: () => void }) {
  return (
    <Drawer title={b.name} sub={`${b.company} · ${b.state}`} onClose={onClose}>
      <section className="ss-sec">
        <h3 className="ss-sec-title">Scorecard</h3>
        <div className="ss-boxed">
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
        </div>
      </section>
      <section className="ss-sec">
        <h3 className="ss-sec-title">Checklists</h3>
        <div className="ss-boxed">
          <ul className="ss-rows">
            {b.due.map((d) => (
              <li key={d.kind} className="ss-task">
                <div className="ss-task-top">
                  <div className="ss-task-title">
                    {EVERY[d.kind]} ({d.period}, due {d.due})
                  </div>
                  <Chip tone={d.done ? 'ok' : 'neutral'}>{d.done ? `Sent ${dateTimeLabel(d.done.at)}` : 'Not sent'}</Chip>
                </div>
                {d.done && (
                  <>
                    <ul className="ss-ticks">
                      {d.done.items.map((i) => (
                        <li key={i.label} data-ok={i.ok}>
                          {`${i.ok ? '✓' : '✗'} ${i.label}${i.note ? ` (${i.note})` : ''}`}
                        </li>
                      ))}
                    </ul>
                    {d.done.proof && <span className="ss-note mono">photo {d.done.proof.sha256.slice(0, 10)}…</span>}
                  </>
                )}
                {!d.done && b.canCheck && <ChecklistForm b={b} kind={d.kind} items={checklists[d.kind].items} />}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="ss-sec">
        <h3 className="ss-sec-title">Visits and spot checks</h3>
        {b.canVisit.length > 0 && (
          <div className="ss-form">
            {b.canVisit.map((k) => (
              <VisitForm key={k} b={b} kind={k} />
            ))}
          </div>
        )}
        <div className="ss-boxed">
          <ul className="ss-rows">
            {b.visits.length === 0 && <li className="empty">No visits recorded.</li>}
            {b.visits.map((v) => (
              <li key={v.id} className="ss-task">
                <div className="ss-task-top">
                  <div className="ss-task-title">
                    {KIND_LABEL[v.kind]} · {dateLabel(v.at.slice(0, 10))}
                  </div>
                  <Chip tone={v.result === 'ok' ? 'ok' : 'crit'}>{v.result === 'ok' ? 'In order' : 'Issues'}</Chip>
                </div>
                <div className="ss-meta">
                  {v.by}
                  {v.announced ? '' : ' · unannounced'}
                </div>
                <div className="small">{v.findings}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Drawer>
  );
}

type Proof = { image: string; capturedAt?: string; lat?: number | null; lng?: number | null };

function ProofCamera({ b, refText, proof, setProof }: { b: BranchRow; refText: string; proof: Proof | null; setProof: (p: Proof | null) => void }) {
  const [cam, setCam] = useState(false);
  if (proof)
    return (
      <div className="ss-actions">
        <Chip tone="ok">Photo ready</Chip>
        <button className="btn btn-sm btn-ghost" onClick={() => setProof(null)}>
          Retake
        </button>
      </div>
    );
  if (!cam)
    return (
      <div className="ss-actions">
        <button className="btn btn-sm" onClick={() => setCam(true)}>
          Take the photo
        </button>
      </div>
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
    <div className="ss-form">
      <div className="ss-checks">
        {items.map((i) => (
          <div key={i.key} className="ss-check-item">
            <label className="ss-check">
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
      </div>
      <ProofCamera b={b} refText={`${EVERY[kind]} checklist`} proof={proof} setProof={setProof} />
      <ErrorNotice error={act.error} />
      <div className="ss-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !proof}
          onClick={() => act.run(() => api.branchCheckSubmit(b.id, { kind, items: items.map((i) => ({ key: i.key, ...state[i.key] })), proof }), 'Checklist sent.')}
        >
          Send {EVERY[kind].toLowerCase()} checklist
        </button>
      </div>
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
      <div className="ss-actions">
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Record {KIND_LABEL[kind].toLowerCase()}
          {kind === 'spot' ? ` (${b.spotsThisMonth} of 2 this month)` : ''}
        </button>
      </div>
    );
  return (
    <div className="ss-sub-form">
      <span className="ss-form-title">{KIND_LABEL[kind]}</span>
      <label className="field">
        <span className="label">Findings</span>
        <textarea className="textarea" rows={3} placeholder="What you found" aria-label="Findings" value={findings} onChange={(e) => setFindings(e.target.value)} />
      </label>
      <label className="ss-check">
        <input type="checkbox" checked={issues} onChange={(e) => setIssues(e.target.checked)} />
        Issues found
      </label>
      {kind !== 'spot' && <ProofCamera b={b} refText={KIND_LABEL[kind]} proof={proof} setProof={setProof} />}
      <ErrorNotice error={act.error} />
      <div className="ss-actions">
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
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
