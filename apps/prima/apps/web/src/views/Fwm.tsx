import { useState } from 'react';
import { BellRingingIcon, ClipboardTextIcon, ClockCountdownIcon, HourglassIcon, PaperPlaneTiltIcon, QuestionIcon, SirenIcon, WarningIcon } from '@phosphor-icons/react';
import { FWM_TASK_LABEL, FW_LEVEL_LABEL, type FwmTaskKind, type FwPaper, type ProofInput } from '@prima/core';
import { api, type FwmBoard } from '../api';
import { Avatar, Empty, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { CooNoticesPanel } from './CooNotices';
import { DocList, ProofPicker } from './Proof';
import { FwmWelfarePanel } from './FwmWelfare';
import '../styles/hrx.css';
import { FwmRecruitmentPanel } from './FwmRecruitment';

/**
 * Foreign Worker Management (Fauzan, 26 Oct 2026). FWM renews every foreign worker's papers and sends the OMs dated
 * tasks; reminders run at 120, 90, 60, 30 and 15 days (15 is urgent) and escalate FWM, Chief of Staff, COO, CEO, with
 * the CEO told 7 days before expiry. A renewal submitted with its receipt pauses the ladder.
 */

type Item = FwmBoard['items'][number];
type TaskRow = FwmBoard['tasks'][number];

const KINDS: FwmTaskKind[] = ['FOMEMA', 'JIM', 'TNG', 'BIOMETRIC', 'OTHER'];
const LIMIT = 200;

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function stageTone(i: Item): Tone {
  if (!i.stage) return 'unknown';
  if (i.stage.paused) return 'info';
  if (i.stage.step === 0 || i.stage.urgent) return 'crit';
  if ((i.stage.step ?? 999) <= 60) return 'warn';
  return 'neutral';
}

export function FwmView() {
  const { data, error } = useLoad(() => api.fwmBoard(), []);
  const [tab, setTab] = useState<'papers' | 'year10' | 'tasks' | 'welfare' | 'recruit' | null>(null);
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState('');
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="foreign workers" />
      </div>
    );
  const board = data.role !== 'om' && data.role !== 'despatch';
  const view = tab ?? (board ? 'papers' : 'tasks');
  const forMeFirst = data.role === 'escalation' && mine;
  const items = forMeFirst ? data.items.filter((i) => i.forMe) : data.items;
  const openTasks = data.tasks.filter((t) => t.task.status !== 'accepted').length;
  const needle = q.trim().toLowerCase();
  const found = needle
    ? items.filter((i) => `${i.person.name} ${i.person.staffNo} ${i.person.companyName} ${i.label}`.toLowerCase().includes(needle))
    : items;
  const tasksFound = needle
    ? data.tasks.filter((t) => `${t.person?.name ?? ''} ${t.person?.staffNo ?? ''} ${t.person?.companyName ?? ''} ${t.label} ${t.omName}`.toLowerCase().includes(needle))
    : data.tasks;
  const yearFound = needle
    ? data.year10.filter((y) => `${y.person.name} ${y.person.staffNo} ${y.person.companyName}`.toLowerCase().includes(needle))
    : data.year10;
  return (
    <div className="page">
      <PageHead
        title="Foreign workers"
        sub={
          data.role === 'om'
            ? 'Tasks from Foreign Worker Management: get the guard there, then send the proof.'
            : 'Foreign Worker Management renews permits, passports, FOMEMA and insurance, and sends the OMs dated tasks.'
        }
      />
      <CooNoticesPanel notices={data.cooNotices} />
      {board ? (
        <Stats>
          {data.level && data.level !== 'FWM' && (
            <Stat
              label={`Reached ${FW_LEVEL_LABEL[data.level]}`}
              value={data.counts.forMe}
              tone={data.counts.forMe ? 'crit' : 'ok'}
              icon={<BellRingingIcon size={16} />}
              note="Papers escalated to you"
            />
          )}
          <Stat label="Expired or urgent" value={data.counts.urgent} tone={data.counts.urgent ? 'crit' : 'ok'} note="15 days or less" icon={<SirenIcon size={16} />} />
          <Stat label="CEO alerted" value={data.counts.ceo} tone={data.counts.ceo ? 'crit' : 'ok'} note="7 days or less" icon={<WarningIcon size={16} />} />
          <Stat label="Renewal submitted" value={data.counts.submitted} note="Ladder paused" tone="info" icon={<PaperPlaneTiltIcon size={16} />} />
          <Stat
            label="No expiry on record"
            value={data.counts.missing}
            tone={data.counts.missing ? 'unknown' : 'ok'}
            note="Unknown, not green"
            icon={<QuestionIcon size={16} />}
          />
        </Stats>
      ) : (
        <Stats>
          <Stat label="Open tasks" value={openTasks} tone={openTasks ? 'warn' : 'ok'} note="Not yet accepted by FWM" icon={<ClipboardTextIcon size={16} />} />
          <Stat
            label="Overdue"
            value={data.tasks.filter((t) => t.overdue).length}
            tone={data.tasks.some((t) => t.overdue) ? 'crit' : 'ok'}
            note="Past the due date"
            icon={<ClockCountdownIcon size={16} />}
          />
          <Stat
            label="Sent back"
            value={data.tasks.filter((t) => t.task.status === 'returned').length}
            tone={data.tasks.some((t) => t.task.status === 'returned') ? 'crit' : 'ok'}
            note="FWM asked for more"
            icon={<HourglassIcon size={16} />}
          />
        </Stats>
      )}
      <div className="tabbar hx-tabs" role="tablist" aria-label="Foreign worker sections">
        {board && (
          <button role="tab" aria-selected={view === 'papers'} onClick={() => setTab('papers')}>
            Papers
          </button>
        )}
        {board && (
          <button role="tab" aria-selected={view === 'year10'} onClick={() => setTab('year10')}>
            Year 10
            {data.year10.length > 0 && <span className="tab-count">{data.year10.length}</span>}
          </button>
        )}
        <button role="tab" aria-selected={view === 'tasks'} onClick={() => setTab('tasks')}>
          Tasks
          {openTasks > 0 && <span className="tab-count">{openTasks}</span>}
        </button>
        {board && (
          <button role="tab" aria-selected={view === 'welfare'} onClick={() => setTab('welfare')}>
            Recruitment and welfare
          </button>
        )}
        {board && (
          <button role="tab" aria-selected={view === 'recruit'} onClick={() => setTab('recruit')}>
            Recruitment steps
          </button>
        )}
      </div>

      {view === 'welfare' && <FwmWelfarePanel />}
      {view === 'recruit' && <FwmRecruitmentPanel />}

      {view !== 'welfare' && (
        <Toolbar
          end={
            view === 'papers' && data.role === 'escalation' ? (
              <div className="seg" role="group" aria-label="Which papers">
                <button aria-pressed={mine} onClick={() => setMine(true)}>
                  For me
                </button>
                <button aria-pressed={!mine} onClick={() => setMine(false)}>
                  All
                </button>
              </div>
            ) : undefined
          }
        >
          <Search value={q} onChange={setQ} placeholder="Search name, staff no or company" label="Search foreign workers" />
        </Toolbar>
      )}

      {view === 'papers' && (
        <div className="hx-stack-tight">
          <section className="k-card">
            <div className="k-card-head">
              <div className="k-card-title">
                <h2>Papers on the reminder ladder</h2>
                <p>Reminders at 120, 90, 60, 30 and 15 days; a submitted renewal pauses the ladder.</p>
              </div>
              <span className="hx-count">
                {found.length > LIMIT ? `First ${LIMIT} of ${found.length}` : `${found.length} paper${found.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {found.length === 0 ? (
              <Empty title={forMeFirst ? 'Nothing has reached you.' : 'No paper within 120 days.'}>{needle ? 'No paper matches the search.' : undefined}</Empty>
            ) : (
              <ul className="hx-rows">
                {found.slice(0, LIMIT).map((i) => (
                  <PaperRow key={`${i.person.id}-${i.paper}`} i={i} canWork={data.canWork} />
                ))}
              </ul>
            )}
          </section>
          <p className="hx-source">
            {data.rules.ladder.source} {data.rules.passport.source}
          </p>
        </div>
      )}

      {view === 'year10' && (
        <div className="hx-stack-tight">
          <section className="k-card">
            <div className="k-card-head">
              <div className="k-card-title">
                <h2>Reaching year {data.rules.cap.value} within a year</h2>
              </div>
              <span className="hx-count">{yearFound.length}</span>
            </div>
            {yearFound.length === 0 ? (
              <Empty title={`Nobody reaches year ${data.rules.cap.value} within a year.`} />
            ) : (
              <ul className="hx-rows">
                {yearFound.map((y) => {
                  const tone = y.plan.daysToLeave < 0 ? 'crit' : y.plan.daysToLeave <= 120 ? 'warn' : 'info';
                  return (
                    <li key={y.person.id} className="hx-row fw-row" data-tone={tone === 'info' ? undefined : tone}>
                      <Avatar name={y.person.name} size={36} />
                      <div className="hx-row-main">
                        <span className="hx-row-title">{y.person.name}</span>
                        <span className="hx-row-meta">
                          {y.person.staffNo} · {y.person.companyName}
                        </span>
                      </div>
                      <div className="hx-row-side">
                        <Chip tone={tone}>
                          Year {y.plan.year} of {y.plan.cap}
                        </Chip>
                      </div>
                      <div className="hx-row-body">
                        <div className="fw-dates">
                          <span>
                            <span className="label">Goes home by</span>
                            <b>{dateLabel(y.plan.leaveBy)}</b>
                          </span>
                          <span>
                            <span className="label">Apply for the fresh permit from</span>
                            <b>{dateLabel(y.plan.applyFrom)}</b>
                          </span>
                          <span>
                            <span className="label">Back from</span>
                            <b>{dateLabel(y.plan.backFrom)}</b>
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <p className="hx-source">{data.rules.cap.source} Service is counted from the hire date until the first permit date is on record.</p>
        </div>
      )}

      {view === 'tasks' && (
        <section className="k-card">
          <div className="k-card-head">
            <div className="k-card-title">
              <h2>Tasks to the OMs</h2>
            </div>
            <span className="hx-count">{openTasks} open</span>
          </div>
          {tasksFound.length === 0 ? (
            <Empty title="No task.">{needle ? 'No task matches the search.' : undefined}</Empty>
          ) : (
            <ul className="hx-rows">
              {tasksFound.map((t) => (
                <TaskRowView key={t.task.id} t={t} reasonRequired={data.reasonRequired} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function PaperRow({ i, canWork }: { i: Item; canWork: boolean }) {
  const [mode, setMode] = useState<'renew' | 'task' | null>(null);
  const tone = stageTone(i);
  return (
    <li className="hx-row fw-row" data-tone={tone === 'crit' || tone === 'warn' || tone === 'unknown' ? tone : undefined}>
      <Avatar name={i.person.name} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {i.person.name} · {i.label}
        </span>
        <span className="hx-row-meta">
          {i.person.staffNo} · {i.person.companyName}
        </span>
      </div>
      <div className="hx-row-side">
        <Chip tone={tone}>
          {i.stage
            ? i.stage.paused
              ? 'Submitted'
              : `${i.daysLeft! < 0 ? 'Expired' : `${i.daysLeft} d`}${i.stage.priority ? ` · ${i.stage.priority}` : ''}`
            : 'Unknown'}
        </Chip>
      </div>
      <div className="hx-row-body">
        <div className="hx-meta-list">
          <span>{i.expiresOn ? <>Expires <b>{dateLabel(i.expiresOn)}</b></> : 'No expiry on record'}</span>
          {i.paper === 'PASSPORT' && i.deadline && (
            <span>
              Renew by <b>{dateLabel(i.deadline)}</b> (12 months left for the PLKS)
            </span>
          )}
          {i.stage && !i.stage.paused && <span>Alerted: {i.stage.alerted.map((l) => FW_LEVEL_LABEL[l]).join(', then ')}</span>}
          {i.renewal && (
            <span>
              Submitted {dateLabel(i.renewal.submittedOn)} via {i.renewal.channel} by {i.renewal.by}
              {i.renewal.note ? ` · ${i.renewal.note}` : ''}
            </span>
          )}
        </div>
        {canWork && !mode && (
          <div className="hx-row-actions">
            {i.expiresOn && !i.renewal && (
              <button className="btn btn-sm" onClick={() => setMode('renew')}>
                Renewal submitted
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setMode('task')}>
              Send task to OM
            </button>
          </div>
        )}
        {mode === 'renew' && <RenewalForm personId={i.person.id} paper={i.paper} onDone={() => setMode(null)} />}
        {mode === 'task' && <TaskForm personId={i.person.id} paper={i.paper} onDone={() => setMode(null)} />}
      </div>
    </li>
  );
}

function RenewalForm({ personId, paper, onDone }: { personId: string; paper: FwPaper; onDone: () => void }) {
  const [submittedOn, setSubmittedOn] = useState(today());
  const [channel, setChannel] = useState(
    paper === 'PLKS_PERMIT' ? 'FWCMS' : paper === 'FOMEMA' ? 'FOMEMA' : paper === 'PASSPORT' ? 'Embassy of Nepal' : 'Insurer',
  );
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Renewal submitted</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Submitted on</span>
          <input className="input" type="date" aria-label="Submitted on" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Where</span>
          <input className="input" aria-label="Where submitted" value={channel} onChange={(e) => setChannel(e.target.value)} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">Note</span>
          <input className="input" aria-label="Renewal note" placeholder="Note, such as levy paid" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !proof.length || channel.trim().length < 3}
          onClick={async () => {
            const ok = await act.run(
              () => api.submitFwRenewal(personId, paper, { submittedOn, channel, note }, proof),
              'Recorded. The reminders pause until the new date is on record.',
            );
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskForm({ personId, paper, onDone }: { personId: string; paper: FwPaper; onDone: () => void }) {
  const [kind, setKind] = useState<FwmTaskKind>(paper === 'FOMEMA' ? 'FOMEMA' : paper === 'PLKS_PERMIT' || paper === 'PASSPORT' ? 'JIM' : 'OTHER');
  const [what, setWhat] = useState('');
  const [place, setPlace] = useState('');
  const [dueOn, setDueOn] = useState(today());
  const act = useAction();
  return (
    <div className="hx-form">
      <h3 className="hx-form-title">Send a task to the OM</h3>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Task</span>
          <select className="select" aria-label="Task kind" value={kind} onChange={(e) => setKind(e.target.value as FwmTaskKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {FWM_TASK_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="date" aria-label="Due" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label className="field hx-form-wide">
          <span className="label">What the OM must do</span>
          <input
            className="input"
            aria-label="What the OM must do"
            placeholder="What the OM must get done"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
          />
        </label>
        <label className="field hx-form-wide">
          <span className="label">Place</span>
          <input className="input" aria-label="Place" placeholder="Where, such as the FOMEMA clinic" value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || what.trim().length < 5}
          onClick={async () => {
            const ok = await act.run(() => api.createFwmTask(personId, { kind, what, place, dueOn }), 'Task sent to the OM.');
            if (ok) onDone();
          }}
        >
          Send
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const STATUS: Record<TaskRow['task']['status'], { label: string; tone: Tone }> = {
  open: { label: 'Waiting for the OM', tone: 'warn' },
  returned: { label: 'Sent back to the OM', tone: 'crit' },
  done: { label: 'Done, FWM to check', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'ok' },
};

/** Where a task is: sent, the OM's proof, FWM's check. */
function taskSteps(t: TaskRow): { label: string; state: StepState; note?: string }[] {
  const s = t.task.status;
  return [
    { label: 'Task sent', state: 'done', note: `due ${dateLabel(t.task.dueOn)}` },
    {
      label: 'OM sends proof',
      state: s === 'open' ? 'now' : s === 'returned' ? 'stopped' : 'done',
      note: s === 'returned' ? 'Sent back' : t.task.doneBy ? t.task.doneBy : undefined,
    },
    { label: 'FWM checks', state: s === 'accepted' ? 'done' : s === 'done' ? 'now' : 'todo' },
  ];
}

function TaskRowView({ t, reasonRequired }: { t: TaskRow; reasonRequired: boolean }) {
  const [mode, setMode] = useState<'done' | 'review' | null>(null);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const docs = useLoad(
    () => (mode === 'review' || t.task.status === 'accepted' ? api.fwmDocs(t.task.id) : Promise.resolve([])),
    [mode, t.task.id, t.task.status],
  );
  const s = STATUS[t.task.status];
  return (
    <li className="hx-row fw-row" data-tone={t.overdue || t.task.status === 'returned' ? 'crit' : undefined}>
      <Avatar name={t.person?.name ?? t.label} size={36} />
      <div className="hx-row-main">
        <span className="hx-row-title">
          {t.label} · {t.person?.name ?? ''}
        </span>
        <span className="hx-row-meta">
          {t.person?.staffNo} · {t.person?.companyName} · due {dateLabel(t.task.dueOn)}
          {t.task.place ? ` · ${t.task.place}` : ''}
        </span>
      </div>
      <div className="hx-row-side">
        {t.overdue && <Chip tone="crit">Overdue</Chip>}
        <Chip tone={s.tone}>{s.label}</Chip>
      </div>
      <div className="hx-row-body">
        <p className="hx-row-text">{t.task.what}</p>
        <Steps steps={taskSteps(t)} />
        <div className="hx-meta-list">
          <span>
            From {t.task.createdBy} to {t.omName}
          </span>
          {t.task.doneBy && (
            <span>
              Done by {t.task.doneBy}, {dateTimeLabel(t.task.doneAt!)}
              {t.task.doneNote ? `: ${t.task.doneNote}` : ''}
            </span>
          )}
          {t.task.reviewNote && <span>FWM: {t.task.reviewNote}</span>}
        </div>
        {t.task.status === 'accepted' && docs.data && <DocList docs={docs.data} />}
        {!mode && (t.canDo || t.canReview) && (
          <div className="hx-row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => setMode(t.canDo ? 'done' : 'review')}>
              {t.canDo ? 'Done, send proof' : 'Check the proof'}
            </button>
          </div>
        )}
        {mode === 'done' && (
          <div className="hx-form">
            <h3 className="hx-form-title">Send the proof to FWM</h3>
            <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />
            <label className="field">
              <span className="label">Note</span>
              <input className="input" aria-label="Done note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !proof.length}
                onClick={async () => {
                  const ok = await act.run(() => api.doneFwmTask(t.task.id, note, proof), 'Sent to FWM to check.');
                  if (ok) setMode(null);
                }}
              >
                Send
              </button>
              <button className="btn btn-sm" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {mode === 'review' && (
          <div className="hx-form">
            <h3 className="hx-form-title">Check the proof</h3>
            {docs.data ? <DocList docs={docs.data} /> : <Loading what="proof" />}
            {reasonRequired && (
              <p className="notice" data-tone="info">
                You are checking in place of FWM: give the reason (a short one is fine). The FWM Manager, Deputy and the officer who sent it are told.
              </p>
            )}
            <label className="field">
              <span className="label">{reasonRequired ? 'Reason' : 'Note'}</span>
              <input
                className="input"
                aria-label="Review note"
                placeholder={reasonRequired ? 'Reason (needed to accept or send back)' : 'Note (needed to send back)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <ErrorNotice error={act.error} />
            <div className="hx-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || (reasonRequired && !note.trim())}
                onClick={() => act.run(() => api.reviewFwmTask(t.task.id, true, note), 'Accepted.')}
              >
                Accept
              </button>
              <button
                className="btn btn-sm"
                disabled={act.busy || note.trim().length < 5}
                onClick={() => act.run(() => api.reviewFwmTask(t.task.id, false, note), 'Sent back to the OM.')}
              >
                Send back
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
