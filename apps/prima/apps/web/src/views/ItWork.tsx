import { useMemo, useState } from 'react';
import { ClockCountdownIcon, HeadsetIcon, KeyIcon, ListChecksIcon, PlusIcon, SealCheckIcon, TrayIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type ItBoard } from '../api';
import { saveFile } from '../save';
import { Chip, notify, Drawer, ErrorNotice, dateLabel, dateTimeLabel, useAction } from '../ui';
import { Avatar, Card, Empty, Facts, Person, Stat, Stats } from '../kit';
import { ProofPicker } from './Proof';
import { useApp } from '../App';
import { JobEmails } from '../connections/mail/job-emails';
import { jobEmailClient } from '../connections/mail/job-emails-client';
import { TenderStepsMine } from './ItPilot';

/**
 * The IT pilot (Fauzan, 28 Oct 2026): "how to edit what to do, how to make sure they do the job given", with the COO
 * monitoring and the CEO overseeing. The IT Manager supervises and is not technical: gives jobs, chases them and
 * accepts the proof. The IT Lead is technical: he checks technical jobs. The CEO owns every system and decides access.
 *
 * Laid out as a service desk: jobs are a queue (priority, job, owner, due, status) that opens into a side panel; my work
 * is my own queue first; the team is the IT Manager's view of each person's load; systems and access are a register.
 */

type JobRow = NonNullable<ItBoard['jobs']>[number];
type Job = JobRow['job'];
type TicketRow = NonNullable<ItBoard['tickets']>[number];

export const JOB_KIND: Record<Job['kind'], string> = {
  task: 'Task',
  install: 'Install or set up',
  check: 'Check',
  training: 'Training (Microsoft 365)',
  access: 'Accounts and access',
  other: 'Other',
};
const JOB_STATUS: Record<Job['status'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  todo: ['warn', 'Not started'],
  doing: ['info', 'Being done'],
  submitted: ['info', 'Done, to check'],
  checked: ['info', 'IT Lead checked'],
  accepted: ['ok', 'Accepted'],
  returned: ['crit', 'Sent back'],
  cancelled: ['unknown', 'Cancelled'],
};
const ROLE: Record<string, string> = { manager: 'IT Manager', lead: 'IT Lead', executive: 'IT Executive' };
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

function waitingText(r: JobRow): string {
  const j = r.job;
  if ((j.status === 'submitted' || j.status === 'checked') && r.nextCheck) return r.nextCheck;
  if (j.status === 'returned') return `Sent back to ${j.assignee}`;
  if (j.status === 'accepted') return `Accepted by ${j.acceptedBy}${r.acceptedLate ? ' (submitted late)' : ''}`;
  if (j.status === 'cancelled') return 'Cancelled';
  return `With ${j.assignee}`;
}

function lateChip(r: JobRow) {
  if (!r.lateDays) return null;
  const who = r.level === 'ceo' ? 'CEO sees it' : r.level === 'coo' ? 'COO sees it' : 'IT Manager sees it';
  return <Chip tone={r.level === 'manager' ? 'warn' : 'crit'}>{`${r.lateDays} day${r.lateDays === 1 ? '' : 's'} late · ${who}`}</Chip>;
}

/** One job in a queue: priority, the job, its owner, due date and where it is. */
export function JobLine({ r, onOpen }: { r: JobRow; onOpen: () => void }) {
  const j = r.job;
  return (
    <button type="button" className="iw-job" data-late={r.lateDays > 0 ? 'yes' : undefined} onClick={onOpen}>
      <span className="iw-pri" data-pri={j.priority}>
        {j.priority}
      </span>
      <span className="iw-job-main">
        <span className="iw-job-title">
          <span className="iw-ref">{j.ref}</span> {j.title}
        </span>
        <span className="iw-job-meta">
          {JOB_KIND[j.kind]}
          {j.technical ? ' · technical' : ''}
          {j.returns ? ` · sent back ${j.returns}×` : ''} · {waitingText(r)}
        </span>
      </span>
      <span className="iw-job-owner">
        <Avatar name={j.assignee} size={26} />
        {/* P80: cut to fit on a phone; the full name on hover. */}
        <span title={j.assignee}>{j.assignee}</span>
      </span>
      <span className="iw-job-due">
        <span className="iw-job-due-label">Due</span> {dateLabel(j.dueOn)}
      </span>
      <span className="iw-job-state">
        {lateChip(r)}
        <Chip tone={JOB_STATUS[j.status][0]}>{JOB_STATUS[j.status][1]}</Chip>
      </span>
    </button>
  );
}

/** A queue of jobs with column names over it on a computer. */
function JobQueue({ rows, onOpen }: { rows: JobRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="iw-queue">
      <div className="iw-queue-head" aria-hidden="true">
        <span>Priority</span>
        <span>Job</span>
        <span>Owner</span>
        <span>Due</span>
        <span>Status</span>
      </div>
      <ul className="iw-queue-rows">
        {rows.map((r) => (
          <li key={r.job.id}>
            <JobLine r={r} onOpen={() => onOpen(r.job.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type JobFilter = 'open' | 'late' | 'check' | 'done' | 'all';
const FILTERS: [JobFilter, string][] = [
  ['open', 'Open'],
  ['late', 'Late'],
  ['check', 'Waiting for a check'],
  ['done', 'Accepted'],
  ['all', 'All'],
];
const inFilter = (r: JobRow, f: JobFilter) =>
  f === 'all' ||
  (f === 'open' && r.open) ||
  (f === 'late' && r.lateDays > 0) ||
  (f === 'check' && (r.job.status === 'submitted' || r.job.status === 'checked')) ||
  (f === 'done' && r.job.status === 'accepted');

/** Jobs: give a job, follow every job, filter by what needs attention. */
export function Jobs({ data }: { data: ItBoard }) {
  const [filter, setFilter] = useState<JobFilter>('open');
  const [who, setWho] = useState('');
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const mine = (data.jobs ?? []).filter((r) => !who || r.job.assigneeId === who);
  const rows = mine.filter((r) => inFilter(r, filter));
  const row = (data.jobs ?? []).find((r) => r.job.id === open) ?? null;
  return (
    <>
      <Card
        title="IT jobs"
        sub={`${rows.length} shown`}
        flush
        actions={
          (data.assigner || data.canGiveJob) && (
            <button className="btn btn-sm btn-primary" aria-expanded={form} onClick={() => setForm(!form)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              Give a job
            </button>
          )
        }
      >
        {form && (
          <div className="iw-inset">
            <GiveJob data={data} onDone={() => setForm(false)} />
          </div>
        )}
        <div className="iw-bar">
          <div className="seg iw-seg" role="group" aria-label="Show">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {label}
                <span className="iw-count">{mine.filter((r) => inFilter(r, f)).length}</span>
              </button>
            ))}
          </div>
          <select className="select iw-bar-select" aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {(data.team ?? [])
              .filter((t) => t.itRole !== 'manager')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        {rows.length ? <JobQueue rows={rows} onOpen={setOpen} /> : <Empty title="Nothing here." />}
        <p className="iw-rule">
          Every job has one named person and a due date. It is finished only when it is submitted with proof and accepted by the IT Manager; a
          technical job is checked by the IT Lead first, and the IT Manager checks the proof of the IT Lead’s own technical jobs. Nobody checks or accepts their own work. The COO may accept or return any job, and whoever was in charge of checking it is told. A job {data.jobRule.cooAfterDays} days late goes to the COO,
          and {data.jobRule.ceoAfterDays} days late to the CEO.
        </p>
      </Card>
      {row && <JobDrawer data={data} r={row} onClose={() => setOpen(null)} />}
    </>
  );
}

function doers(data: ItBoard) {
  return (data.team ?? []).filter((t) => t.itRole !== 'manager');
}

/** Regular work from the IT plan, filled in for the manager to check and give. */
export type JobPreset = { kind: Job['kind']; title: string; detail: string; dueOn: string; technical: boolean; planKey: string };

export function GiveJob({ data, onDone, preset }: { data: ItBoard; onDone: () => void; preset?: JobPreset }) {
  const act = useAction();
  const [kind, setKind] = useState<Job['kind']>(preset?.kind ?? 'task');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [detail, setDetail] = useState(preset?.detail ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueOn, setDueOn] = useState(preset && preset.dueOn > today() ? preset.dueOn : today());
  const [priority, setPriority] = useState<'P1' | 'P2' | 'P3'>('P3');
  const [technical, setTechnical] = useState(preset?.technical ?? false);
  return (
    <div className="iw-form">
      <label className="field iw-span">
        <span className="label">Job</span>
        <input className="input" aria-label="Job" placeholder="What has to be done" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field iw-span">
        <span className="label">Details</span>
        <textarea className="input" aria-label="Details" placeholder="Details: where, for whom, what counts as done" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Kind</span>
        <select className="select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Job['kind'])}>
          {(Object.keys(JOB_KIND) as Job['kind'][]).map((k) => (
            <option key={k} value={k}>
              {JOB_KIND[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Give to</span>
        <select className="select" aria-label="Give to" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Give to…</option>
          {doers(data).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Urgency</span>
        <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
          <option value="P1">P1 urgent</option>
          <option value="P2">P2 soon</option>
          <option value="P3">P3 normal</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Due</span>
        <input className="input" type="date" aria-label="Due" value={dueOn} min={today()} onChange={(e) => setDueOn(e.target.value)} />
      </label>
      <label className="row small iw-span iw-check">
        <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
        <span>Technical: the IT Lead checks it before the IT Manager accepts it</span>
      </label>
      <div className="iw-span iw-form-foot">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-primary"
          disabled={act.busy || !title.trim() || !assigneeId}
          onClick={() =>
            act
              .run(() => api.itAct('giveJob', { kind, title, detail, assigneeId, dueOn, priority, technical, planKey: preset?.planKey }), 'Job given.')
              .then((r) => r && onDone())
          }
        >
          Give the job
        </button>
      </div>
    </div>
  );
}

const LOG_WHAT: Record<string, string> = {
  start: 'Started',
  note: 'Note',
  submit: 'Submitted',
  check: 'IT Lead check passed',
  accept: 'Accepted',
  return: 'Sent back',
  edit: 'Changed',
  cancel: 'Cancelled',
};

export function JobDrawer({ data, r, onClose }: { data: ItBoard; r: JobRow; onClose: () => void }) {
  const {me}=useApp();
  const emailClient=useMemo(()=>jobEmailClient((...args)=>api.m365Call(me.user.id,...args)),[me.user.id]);
  // P78: inside the Agentic Office the browser holds no Microsoft token, so filing emails to a job uses the office's mail.
  const inOffice=(api as { office?: boolean }).office===true;
  // The COO may decide anyone's IT job, always with a reason; whoever was in charge is told (Fauzan, 31 Oct 2026).
  const coo = data.role === 'coo' || data.role === 'view'; // The CEO's IT role is 'view'; he has full authority (Fauzan, 31 Oct 2026).
  const act = useAction();
  const j = r.job;
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const [edit, setEdit] = useState(false);
  const step = (s: string, ok: string) =>
    act.run(() => api.itAct('jobStep', { id: j.id, step: s, note, proof: s === 'submit' ? proof : [] }), ok).then((x) => {
      if (x) {
        setNote('');
        setProof([]);
      }
    });
  const download = async (sha256: string, name: string) => {
    const f = (await act.run(() => api.itAct('jobProof', { id: j.id, sha256 }))) as { data: string } | undefined;
    if (f) {
      const m = await saveFile(name, f.data);
      if (m) notify(m);
    }
  };
  const c = r.can;
  return (
    <Drawer title={`${j.ref} · ${j.title}`} sub={`${JOB_KIND[j.kind]} · ${j.priority}${j.technical ? ' · technical' : ''}`} onClose={onClose}>
      <ErrorNotice error={act.error} />
      <div className="iw-chips">
        {lateChip(r)}
        <Chip tone={JOB_STATUS[j.status][0]}>{JOB_STATUS[j.status][1]}</Chip>
      </div>
      <div className="iw-facts">
        <Facts
          items={[
            ['Doer', <Person key="d" name={j.assignee} size={28} />],
            ['Given by', `${j.givenBy}, ${dateTimeLabel(j.at)}`],
            ['Due', dateLabel(j.dueOn)],
            ['Next', waitingText(r)],
          ]}
        />
        {j.detail && <p className="iw-detail">{j.detail}</p>}
      </div>
      {inOffice
        ? <p className="notice" data-tone="info">Job emails use your office Microsoft 365 connection. Open Mail in the office to find the email and file it to {j.ref}.</p>
        : <JobEmails key={`${me.user.id}:${j.id}`} client={emailClient} userId={me.user.id} jobId={j.id} />}
      <section className="iw-sec">
        <h3>Proof</h3>
        {!j.proof.length && <p className="muted small">No proof yet. A job cannot be submitted without it.</p>}
        {j.proof.length > 0 && (
          <ul className="iw-files">
            {j.proof.map((p) => (
              <li key={p.sha256}>
                <button className="link-button iw-file-name" onClick={() => void download(p.sha256, p.name)}>
                  {p.name}
                </button>
                <span className="muted small">
                  {p.by}, {dateTimeLabel(p.at)} · SHA-256 {p.sha256.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {(c.start || c.submit || c.check || c.accept || c.back || c.cancel || c.note) && (
        <section className="iw-sec iw-act">
          <h3>Act</h3>
          <label className="field">
            <span className="label">Note</span>
            <textarea
              className="input"
              aria-label="Note"
              placeholder={
                c.submit
                  ? 'What was done (needed to submit)'
                  : coo && (c.accept || c.back)
                    ? 'Why you decide in place of the person in charge (needed)'
                    : c.check
                      ? 'What you checked (needed to pass the check), or what is missing (to send back)'
                      : c.accept
                        ? 'Why you accept it (needed), or what is missing (to send back)'
                        : c.back
                          ? 'What is missing (needed to send back)'
                          : 'Note or update'
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {c.submit && <ProofPicker site={null} refText={j.ref} items={proof} onChange={setProof} documentsOnly required />}
          <div className="iw-actions">
            {c.start && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => void step('start', 'Started.')}>
                Start
              </button>
            )}
            {c.submit && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim() || !proof.length} onClick={() => void step('submit', 'Submitted with proof.')}>
                Submit as done
              </button>
            )}
            {c.check && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => void step('check', 'Technical check passed.')}>
                Technical check passed
              </button>
            )}
            {c.accept && (
              <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => void step('accept', 'Accepted.')}>
                Accept
              </button>
            )}
            {c.back && (
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void step('return', 'Sent back.')}>
                Send back
              </button>
            )}
            {c.note && (
              <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => void step('note', 'Note added.')}>
                Add note
              </button>
            )}
            {c.cancel && (
              <button className="btn btn-sm" disabled={act.busy || note.trim().length < 5} onClick={() => void step('cancel', 'Cancelled.')}>
                Cancel job
              </button>
            )}
            {c.edit && (
              <button className="btn btn-sm btn-ghost" aria-expanded={edit} onClick={() => setEdit(!edit)}>
                Change the job
              </button>
            )}
          </div>
        </section>
      )}
      {edit && <EditJob data={data} j={j} onDone={() => setEdit(false)} />}
      <section className="iw-sec">
        <h3>History</h3>
        <ol className="iw-history">
          <li>
            <span>Given to {j.assignee}</span>
            <span className="muted small">
              {dateTimeLabel(j.at)} · {j.givenBy}
            </span>
          </li>
          {j.log.map((l, i) => (
            <li key={i}>
              <span>
                {LOG_WHAT[l.what]}
                {l.note ? `: ${l.note}` : ''}
              </span>
              <span className="muted small">
                {dateTimeLabel(l.at)} · {l.by}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Drawer>
  );
}

function EditJob({ data, j, onDone }: { data: ItBoard; j: Job; onDone: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(j.title);
  const [detail, setDetail] = useState(j.detail);
  const [dueOn, setDueOn] = useState(j.dueOn < today() ? today() : j.dueOn);
  const [assigneeId, setAssigneeId] = useState(j.assigneeId);
  const [priority, setPriority] = useState(j.priority);
  const [technical, setTechnical] = useState(j.technical);
  const [reason, setReason] = useState('');
  return (
    <section className="iw-sec iw-act">
      <h3>Change the job</h3>
      <div className="iw-form">
        <label className="field iw-span">
          <span className="label">Job</span>
          <input className="input" aria-label="Job" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field iw-span">
          <span className="label">Details</span>
          <textarea className="input" aria-label="Details" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Doer</span>
          <select className="select" aria-label="Doer" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {doers(data).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Urgency</span>
          <select className="select" aria-label="Urgency" value={priority} onChange={(e) => setPriority(e.target.value as 'P1' | 'P2' | 'P3')}>
            <option value="P1">P1 urgent</option>
            <option value="P2">P2 soon</option>
            <option value="P3">P3 normal</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Due</span>
          <input className="input" type="date" aria-label="Due" value={dueOn} min={today()} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label className="row small iw-check">
          <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
          <span>Technical (IT Lead checks)</span>
        </label>
        <label className="field iw-span">
          <span className="label">Why</span>
          <input className="input" aria-label="Why" placeholder="Why it is changed (kept in the history)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="iw-span iw-form-foot">
          <ErrorNotice error={act.error} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || reason.trim().length < 3}
            onClick={() =>
              act
                .run(
                  () =>
                    api.itAct('editJob', {
                      id: j.id,
                      reason,
                      patch: {
                        title,
                        detail,
                        dueOn: dueOn !== j.dueOn ? dueOn : undefined,
                        assigneeId: assigneeId !== j.assigneeId ? assigneeId : undefined,
                        priority,
                        technical,
                      },
                    }),
                  'Job changed.',
                )
                .then((x) => x && onDone())
            }
          >
            Save the change
          </button>
        </div>
      </div>
    </section>
  );
}

/** Assign a help request, a joiner or leaver, or a tender's IT part to one person. */
export function AssignPick({ data, current, onPick, busy }: { data: ItBoard; current: string | null | undefined; onPick: (id: string) => void; busy: boolean }) {
  return (
    <select className="select iw-assign" aria-label="Give to" value={current ?? ''} disabled={busy} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{current ? 'Give to…' : 'Nobody yet: give to…'}</option>
      {doers(data).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/** Everything given to me, and for the IT Manager and IT Lead what waits for their check. */
export function MyWork({ data, openTab }: { data: ItBoard; openTab: (t: 'jobs' | 'tickets' | 'onboarding' | 'tenders') => void }) {
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const w = data.myWork;
  if (!w) return null;
  const row = (data.jobs ?? []).find((r) => r.job.id === open) ?? null;
  const manager = data.role === 'manager';
  const late = manager ? (data.jobs ?? []).filter((r) => r.lateDays > 0 && !r.can.accept && r.job.status !== 'submitted') : [];
  const nothing = !w.jobs.length && !w.toCheck.length && !w.tickets.length && !w.unassigned.length && !w.onboarding.length && !w.tenders.length && !late.length && !(w.tenderSteps ?? []).length && !(w.cooNotices ?? []).length;
  const myLate = w.jobs.filter((r) => r.lateDays > 0).length;
  const ticketsLate = w.tickets.filter((t) => t.breached).length;
  const given = w.onboarding.length + w.tenders.length;
  return (
    <>
      <p className="iw-lead">
        {manager
          ? 'You make sure the team does the job: give work, check the proof and accept or return it (the IT Lead’s jobs too), and chase what is late.'
          : data.lead
            ? 'Your jobs, and the technical checks waiting for you. You also give out help requests and jobs.'
            : 'Everything given to you. Submit each job with proof; the IT Manager accepts it.'}
      </p>
      <ErrorNotice error={act.error} />
      <Stats>
        {!manager && <Stat label="My jobs" value={w.jobs.length} note={myLate ? `${myLate} late` : 'None late'} tone={myLate ? 'crit' : undefined} icon={<ListChecksIcon size={16} />} />}
        {(manager || data.lead) && (
          <Stat label={manager ? 'Done, for you to accept' : 'For your technical check'} value={w.toCheck.length} tone={w.toCheck.length ? 'warn' : undefined} icon={<SealCheckIcon size={16} />} />
        )}
        {manager && <Stat label="Late jobs to chase" value={late.length} tone={late.length ? 'crit' : undefined} icon={<ClockCountdownIcon size={16} />} />}
        <Stat
          label="My help requests"
          value={w.tickets.length}
          note={w.unassigned.length ? `${w.unassigned.length} nobody has` : ticketsLate ? `${ticketsLate} past time limit` : undefined}
          tone={ticketsLate || w.unassigned.length ? 'warn' : undefined}
          icon={<HeadsetIcon size={16} />}
          onClick={() => openTab('tickets')}
        />
        <Stat label="Joiners, leavers and tenders" value={given} icon={<TrayIcon size={16} />} />
      </Stats>
      {nothing && (
        <Card>
          <Empty title="Nothing is waiting for you." />
        </Card>
      )}
      {(w.cooNotices ?? []).length > 0 && (
        <Card title="The COO or CEO decided these" flush>
          <ul className="iw-rows">
            {(w.cooNotices ?? []).map((n) => (
              <li key={n.noticeId} className="iw-row">
                <div className="iw-row-main">
                  <span className="iw-row-title">
                    <span className="iw-ref">{n.ref}</span> {n.title}
                  </span>
                  <span className="iw-row-meta">
                    {n.by} {n.what === 'accept' ? 'accepted it' : 'sent it back'} · {dateTimeLabel(n.at)}
                    {n.note ? ` · ${n.note}` : ''}
                  </span>
                </div>
                <div className="iw-row-side">
                  <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('seenNotice', { id: n.jobId, noticeId: n.noticeId }), 'Noted.')}>
                    Seen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TenderStepsMine data={data} openTab={() => openTab('tenders')} />
      {w.toCheck.length > 0 && (
        <Card title={manager ? 'Done, for you to accept' : 'For your technical check'} sub={`${w.toCheck.length} waiting`} flush>
          <JobQueue rows={w.toCheck} onOpen={setOpen} />
        </Card>
      )}
      {w.jobs.length > 0 && (
        <Card title="My jobs" sub={`${w.jobs.length} given to you`} flush>
          <JobQueue rows={w.jobs} onOpen={setOpen} />
        </Card>
      )}
      {late.length > 0 && (
        <Card title="Late jobs to chase" sub={`${late.length} late`} flush>
          <JobQueue rows={late} onOpen={setOpen} />
        </Card>
      )}
      {w.unassigned.length > 0 && (
        <Card title="Help requests nobody has" sub="Give each one to a person" flush>
          <ul className="iw-rows">
            {w.unassigned.map((t) => (
              <li key={t.ticket.id} className="iw-row">
                <span className="iw-pri" data-pri={t.ticket.priority}>
                  {t.ticket.priority}
                </span>
                <div className="iw-row-main">
                  <span className="iw-row-title">
                    <span className="iw-ref">{t.ticket.ref}</span> {t.ticket.title}
                  </span>
                  <span className="iw-row-meta">
                    {t.ticket.priority} · {t.ticket.raisedBy} · due {dateTimeLabel(t.due)}
                  </span>
                </div>
                <div className="iw-row-side">
                  <AssignPick data={data} current={null} busy={act.busy} onPick={(id) => void act.run(() => api.itAct('assignTicket', { id: t.ticket.id, toId: id }), 'Given.')} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {w.tickets.length > 0 && (
        <Card
          title="My help requests"
          flush
          actions={
            <button className="btn btn-sm" onClick={() => openTab('tickets')}>
              Open help requests
            </button>
          }
        >
          <ul className="iw-rows">
            {w.tickets.map((t: TicketRow) => (
              <li key={t.ticket.id} className="iw-row">
                <span className="iw-pri" data-pri={t.ticket.priority}>
                  {t.ticket.priority}
                </span>
                <div className="iw-row-main">
                  <span className="iw-row-title">
                    <span className="iw-ref">{t.ticket.ref}</span> {t.ticket.title}
                  </span>
                </div>
                <div className="iw-row-side">
                  <Chip tone={t.breached ? 'crit' : 'info'}>{t.breached ? 'Past time limit' : `due ${dateTimeLabel(t.due)}`}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(w.onboarding.length > 0 || w.tenders.length > 0) && (
        <Card title="Joiners, leavers and tenders given to me" flush>
          <ul className="iw-rows">
            {w.onboarding.map((o) => (
              <li key={o.item.id}>
                <button className="iw-row iw-row-btn" onClick={() => openTab('onboarding')}>
                  <span className="iw-row-main">
                    <span className="iw-row-title">
                      {o.item.personName} · {o.item.kind === 'join' ? 'joins' : 'leaves'} {dateLabel(o.item.on)}
                    </span>
                  </span>
                  <span className="iw-row-side">
                    <Chip tone={o.late ? 'crit' : 'warn'}>{o.open} to do</Chip>
                  </span>
                </button>
              </li>
            ))}
            {w.tenders.map((t) => (
              <li key={t.task.id}>
                <button className="iw-row iw-row-btn" onClick={() => openTab('tenders')}>
                  <span className="iw-row-main">
                    <span className="iw-row-title">{t.task.title}</span>
                  </span>
                  <span className="iw-row-side">
                    <Chip tone={t.daysLeft <= 3 ? 'crit' : 'warn'}>{`${t.open} to fill · ${t.daysLeft} days`}</Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {row && <JobDrawer data={data} r={row} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Each person's record for the last 30 days: for the IT Manager, the IT Lead, the COO and the CEO. */
export function Team({ data }: { data: ItBoard }) {
  const k = data.kpis!;
  const rows = data.teamRows ?? [];
  return (
    <>
      <Stats>
        <Stat label="Jobs open" value={k.jobsOpen} note={`${k.jobsWaitingCheck} waiting for a check`} icon={<ListChecksIcon size={16} />} />
        <Stat label="Jobs late" value={k.jobsLate} tone={k.jobsLate ? 'crit' : 'ok'} note={`${k.jobsToCoo} gone to the COO or CEO`} icon={<ClockCountdownIcon size={16} />} />
        <Stat label="Help requests late" value={k.ticketsLate} tone={k.ticketsLate ? 'crit' : 'ok'} note={`${k.ticketsUnassigned} not given to anyone`} icon={<WarningIcon size={16} />} />
        <Stat label="Access for the CEO" value={k.accessWaiting} tone={k.accessWaiting ? 'warn' : 'ok'} note={`${k.accessReviewDue} systems due for review`} icon={<KeyIcon size={16} />} />
      </Stats>
      <Card title="Who is doing what (last 30 days)" sub={`${rows.length} people`} flush>
        <p className="iw-rule iw-rule-top">
          On time means accepted jobs submitted by the due date and help requests fixed within their time limit. Sent back counts work the IT Manager
          or IT Lead returned. Reopened counts fixes the person who asked said did not work. Tender steps counts eP tender steps finished, and how many took
          longer than their minutes.
        </p>
        <div className="table-wrap iw-table">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Jobs open</th>
                <th>Late</th>
                <th>To check</th>
                <th>Done</th>
                <th>Sent back</th>
                <th>Help open</th>
                <th>Help late</th>
                <th>Help fixed</th>
                <th>Reopened</th>
                <th>On time</th>
                <th>Tender steps</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="iw-person-cell">
                    <Person name={r.name} sub={ROLE[r.itRole ?? ''] ?? ''} size={32} />
                  </td>
                  {r.itRole === 'manager' ? (
                    <td colSpan={10} className="muted small">
                      Supervises: gives work and accepts it. Not given jobs.
                    </td>
                  ) : (
                    <>
                      <td className="iw-num">{r.jobsOpen}</td>
                      <td className="iw-num">{r.jobsLate ? <Chip tone="crit">{r.jobsLate}</Chip> : 0}</td>
                      <td className="iw-num">{r.waitingCheck}</td>
                      <td className="iw-num">{r.jobsDone}</td>
                      <td className="iw-num">{r.sentBack}</td>
                      <td className="iw-num">{r.ticketsOpen}</td>
                      <td className="iw-num">{r.ticketsLate ? <Chip tone="crit">{r.ticketsLate}</Chip> : 0}</td>
                      <td className="iw-num">{r.ticketsDone}</td>
                      <td className="iw-num">{r.reopened}</td>
                      <td>{r.onTimePct == null ? <Chip tone="unknown">No work yet</Chip> : <Chip tone={r.onTimePct >= 90 ? 'ok' : r.onTimePct >= 75 ? 'warn' : 'crit'}>{`${r.onTimePct}%`}</Chip>}</td>
                    </>
                  )}
                  <td className="iw-num">
                    {r.tenderSteps}
                    {r.tenderStepsLate ? (
                      <>
                        {' '}
                        <Chip tone="warn">{`${r.tenderStepsLate} over time`}</Chip>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Every system the group runs: the CEO owns it and decides who may sign in; IT only operates (Fauzan, 28 Oct 2026). */
export function Systems({ data }: { data: ItBoard }) {
  const act = useAction();
  const staff = data.role === 'manager' || data.role === 'team';
  const [ask, setAsk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const requests = data.accessRequests ?? [];
  const accounts = data.accounts ?? [];
  const waiting = requests.filter((r) => r.request.status === 'waiting').length;
  const reviewDue = accounts.filter((a) => a.reviewDue).length;
  const mfaOff = accounts.filter((a) => a.account.mfa === false).length;
  const notCeo = accounts.filter((a) => a.notOwnedByCeo).length;
  return (
    <>
      <Stats>
        <Stat label="Systems" value={accounts.length} icon={<UsersThreeIcon size={16} />} />
        <Stat label="With the CEO" value={waiting} note="Access requests waiting" tone={waiting ? 'warn' : undefined} icon={<KeyIcon size={16} />} />
        <Stat label="Review due" value={reviewDue} tone={reviewDue ? 'warn' : undefined} icon={<ClockCountdownIcon size={16} />} />
        <Stat label="Two-step sign-in off" value={mfaOff} note={notCeo ? `${notCeo} not owned by the CEO` : undefined} tone={mfaOff || notCeo ? 'crit' : undefined} icon={<WarningIcon size={16} />} />
      </Stats>
      <Card title="Recorded access requests for the CEO" sub={waiting ? `${waiting} waiting for a decision` : `${requests.length} recorded`} flush>
        <ErrorNotice error={act.error} />
        {!requests.length && <Empty title="None." />}
        <ul className="iw-rows">
          {requests.map((r) => (
            <li key={r.request.id} className="iw-row iw-row-stack">
              <div className="iw-row-main">
                <span className="iw-row-title">
                  <span className="iw-ref">{r.request.ref}</span> {r.request.action === 'grant' ? `Give ${r.request.name} ${r.request.level} access` : `Remove ${r.request.name}`} · {r.system}
                </span>
                <span className="iw-row-meta">
                  Asked by {r.request.askedBy}, {dateTimeLabel(r.request.at)} · {r.request.reason}
                  {r.request.decidedBy ? ` · ${r.request.decidedBy}${r.request.decisionNote ? `: ${r.request.decisionNote}` : ''}` : ''}
                </span>
              </div>
              <div className="iw-row-side">
                <Chip tone={r.request.status === 'waiting' ? 'warn' : r.request.status === 'approved' ? 'ok' : 'crit'}>
                  {r.request.status === 'waiting' ? 'With the CEO' : r.request.status === 'approved' ? 'Approved' : 'Rejected'}
                </Chip>
              </div>
              {r.canDecide && (
                <div className="iw-row-extra iw-decide">
                  <input className="input" aria-label="Note" placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="iw-actions">
                    <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => void act.run(() => api.itAct('decideAccess', { id: r.request.id, approve: true, note }), 'Approval recorded. Apply and verify external access separately.')}>
                      Approve
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || !note.trim()}
                      onClick={() => void act.run(() => api.itAct('decideAccess', { id: r.request.id, approve: false, note }), 'Rejected.')}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Systems and recorded access" sub={`${accounts.length} systems · the CEO confirms each list every ${data.jobRule.accessReviewDays} days`} flush>
        <p className="iw-rule iw-rule-top">
          The CEO is the owner and master administrator of every system, domain and account. IT staff only operate them with approved access. This register records decisions; it does not grant or revoke access in Microsoft or other systems.
          Passwords are never kept here; only where the CEO’s master sign-in and recovery codes are kept. The CEO confirms each list every{' '}
          {data.jobRule.accessReviewDays} days.
        </p>
        <ul className="iw-rows">
          {accounts.map((a) => (
            <li key={a.account.id} className="iw-sys">
              <div className="iw-sys-main">
                <span className="iw-row-title">{a.account.name}</span>
                <span className="iw-row-meta">
                  Owner {a.account.owner} · master sign-in kept: {a.account.masterKeptAt} · two-step sign-in{' '}
                  {a.account.mfa == null ? 'unknown' : a.account.mfa ? 'on' : 'OFF'}
                  {a.account.note ? ` · ${a.account.note}` : ''}
                </span>
              </div>
              <div className="iw-sys-access">
                <span className="iw-mini-label">Recorded access</span>
                {a.account.access.length ? (
                  <span className="iw-tags">
                    {a.account.access.map((x) => (
                      <span key={x.name + x.level} className="iw-tag">{`${x.name} (${x.level})`}</span>
                    ))}
                  </span>
                ) : (
                  <span className="muted small">No IT access recorded; external permissions are not verified</span>
                )}
              </div>
              <div className="iw-sys-state">
                {a.notOwnedByCeo && <Chip tone="crit">Not owned by the CEO</Chip>}
                {a.account.mfa === false && <Chip tone="crit">Two-step sign-in off</Chip>}
                <Chip tone={a.reviewDue ? 'warn' : 'ok'}>{a.reviewDue ? 'Review due' : `Reviewed ${dateLabel(a.account.reviewedOn!)}`}</Chip>
              </div>
              {(data.ceo || staff) && (
                <div className="iw-sys-actions">
                  {data.ceo && (
                    <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.itAct('reviewAccount', { id: a.account.id }), 'Recorded access list reviewed; external permissions still require verification.')}>
                      Confirm the recorded list
                    </button>
                  )}
                  {staff && (
                    <button className="btn btn-sm" aria-expanded={ask === a.account.id} onClick={() => setAsk(ask === a.account.id ? null : a.account.id)}>
                      Ask the CEO to change access
                    </button>
                  )}
                </div>
              )}
              {ask === a.account.id && (
                <div className="iw-sys-ask">
                  <AskAccess data={data} accountId={a.account.id} onDone={() => setAsk(null)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function AskAccess({ data, accountId, onDone }: { data: ItBoard; accountId: string; onDone: () => void }) {
  const act = useAction();
  const [action, setAction] = useState<'grant' | 'remove'>('grant');
  const [userId, setUserId] = useState('');
  const [level, setLevel] = useState<'operator' | 'admin'>('operator');
  const [reason, setReason] = useState('');
  return (
    <div className="iw-form">
      <label className="field">
        <span className="label">Change</span>
        <select className="select" aria-label="Change" value={action} onChange={(e) => setAction(e.target.value as 'grant' | 'remove')}>
          <option value="grant">Give access</option>
          <option value="remove">Remove access</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Person</span>
        <select className="select" aria-label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Person…</option>
          {(data.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {action === 'grant' && (
        <label className="field">
          <span className="label">Level</span>
          <select className="select" aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value as 'operator' | 'admin')}>
            <option value="operator">Operator</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      )}
      <label className="field iw-span">
        <span className="label">Why</span>
        <input className="input" aria-label="Why" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="iw-span iw-form-foot">
        <ErrorNotice error={act.error} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !userId || reason.trim().length < 5}
          onClick={() => act.run(() => api.itAct('askAccess', { accountId, action, userId, level, reason }), 'Sent to the CEO.').then((x) => x && onDone())}
        >
          Send to the CEO
        </button>
      </div>
    </div>
  );
}
